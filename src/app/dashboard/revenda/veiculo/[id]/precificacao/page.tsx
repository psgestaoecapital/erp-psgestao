'use client'

// Revenda · Onda 6A — precificação. O preço de venda passa a existir, com uma conta atrás.
// A tela mostra o que sabe, declara o que não sabe (RD-51/58) e NUNCA completa lacuna com zero.
// Simulador reverso (é assim que o comprador pensa): parte do preço de venda, chega no teto de compra.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5',
  red: '#B42318', redBg: '#FDECEC',
}
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d?: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const numOrNull = (s: string): number | null => { const n = Number(String(s).replace(',', '.')); return s.trim() !== '' && Number.isFinite(n) ? n : null }

type Encargo = { pct: number | null; valor: number | null; configurado: boolean; fonte?: string | null; base?: string | null; rotulo?: string | null; na_precificacao?: boolean; status?: string | null }
type Precif = {
  ok?: boolean
  veiculo?: { id: string; marca: string | null; modelo: string | null; placa: string | null }
  custo?: { aquisicao: number | null; custos_lancados: number; previsao_gastos: number | null; custo_base: number; custo_total: number; comissao_reais?: number | null }
  encargos?: { impostos: Encargo; comissao: Encargo; garantia: Encargo }
  preco_minimo?: number; piso_sem_margem?: number | null; preco_sugerido?: number | null; margem_alvo_pct?: number | null
  preco_venda?: number | null; precificado_em?: string | null; margem_projetada?: number | null
  incerteza?: Record<string, boolean>; piso_incompleto?: boolean
  historico?: { preco_venda: number | null; preco_minimo: number | null; margem_alvo_pct: number | null; premissas: Record<string, unknown> | null; observacao: string | null; criado_em: string }[]
}
type Estat = { ok?: boolean; tem_historico?: boolean; n_vendas?: number; dias_medio_patio?: number; margem_media_pct?: number }
type Cenario = { dias: number; lucro_real: number | null }
type Cenarios = {
  ok?: boolean; preco_referencia?: number | null; preco_referencia_fonte?: string | null; sangria_dia?: number | null
  cenarios?: Cenario[]
  giro_modelo?: { dias_medios: number | null; amostra: number; este_dias: number | null; recomendacao: string }
  comparacao_estoque?: { veiculo_id: string; placa: string | null; preco_venda: number | null; dias_parado: number | null }[]
  frescor?: { dias_desde: number | null }
}
type ItemAval = { resposta_id: string; item: string; gasto_previsto: number | null; recusado: boolean; motivo: string | null }
type Itens = { ok?: boolean; itens?: ItemAval[]; previsao?: { ajustada: number | null; recusada: number | null; bruta: number | null } }
const GIRO_LABEL: Record<string, { t: string; fg: string; bg: string }> = {
  acima_do_giro: { t: 'acima do giro', fg: '#B42318', bg: '#FDECEC' },
  dentro_do_giro: { t: 'dentro do giro', fg: '#166534', bg: '#ECFDF5' },
  sem_historico: { t: 'sem histórico', fg: '#6B5D4F', bg: '#F0ECE3' },
}

export default function PrecificacaoPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const params = useParams()
  const veiculoId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params!.id[0] : ''
  const [p, setP] = useState<Precif | null>(null)
  const [estat, setEstat] = useState<Estat | null>(null)
  const [precoVenda, setPrecoVenda] = useState('')
  const [margem, setMargem] = useState('')
  const [obs, setObs] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [cen, setCen] = useState<Cenarios | null>(null)
  const [itens, setItens] = useState<Itens | null>(null)
  const [busyItem, setBusyItem] = useState(false)

  async function userId() { const { data: { session } } = await supabase.auth.getSession(); return session?.user?.id ?? null }

  const carregar = useCallback(async () => {
    if (!veiculoId) return
    const { data: veic } = await supabase.from('veic_veiculo').select('company_id, marca, modelo').eq('id', veiculoId).maybeSingle()
    const comp = (veic as { company_id?: string; marca?: string; modelo?: string } | null)?.company_id ?? null
    const { data: pr } = await supabase.rpc('fn_veic_precificacao_obter', { p_veiculo_id: veiculoId })
    const r = pr as Precif | null
    if (r?.ok) {
      setP(r)
      if (r.preco_venda != null) setPrecoVenda(String(r.preco_venda))
      if (r.margem_alvo_pct != null) setMargem(String(r.margem_alvo_pct))
    }
    if (comp) {
      const marca = (veic as { marca?: string } | null)?.marca ?? null
      const modelo = (veic as { modelo?: string } | null)?.modelo ?? null
      const { data: es } = await supabase.rpc('fn_veic_modelo_estatisticas', { p_company_id: comp, p_marca: marca, p_modelo: modelo })
      setEstat(es as Estat | null)
    }
    // R6: cenários (carrego), giro, comparação, frescor e itens da avaliação — da fonte única.
    const [{ data: c }, { data: it }] = await Promise.all([
      supabase.rpc('fn_veic_precificacao_cenarios', { p_veiculo_id: veiculoId }),
      supabase.rpc('fn_veic_avaliacao_itens', { p_veiculo_id: veiculoId }),
    ])
    setCen(c as Cenarios | null); setItens(it as Itens | null)
  }, [veiculoId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  // simulação client-side (RD-42: não bate no servidor a cada tecla). RD-65: mesma conta POR DENTRO da
  // fonte única — encargos e margem incidem sobre o PREÇO. O piso vem do servidor (piso_sem_margem).
  const sim = useMemo(() => {
    if (!p?.custo) return null
    const pv = numOrNull(precoVenda)
    const mg = numOrNull(margem) ?? 0
    const imp = p.encargos?.impostos.pct ?? 0
    const com = p.encargos?.comissao.pct ?? 0
    const gar = p.encargos?.garantia.pct ?? 0
    const encFrac = (imp + com + gar) / 100
    const custoTotal = p.custo.custo_total
    // comissão em R$ (base FIPE/fixo) entra no numerador; base preço/lucro já está no % acima. Fonte única.
    const comR = p.custo.comissao_reais ?? 0
    // piso = ponto onde a margem projetada zera (custo + comissão R$ + encargos, por dentro). Servidor manda.
    const precoMin = p.piso_sem_margem ?? (encFrac < 1 ? (custoTotal + comR) / (1 - encFrac) : null)
    // teto de compra: o quanto pode pagar na aquisição p/ vender por pv com a margem mg (por dentro).
    const teto = pv != null ? pv * (1 - encFrac - mg / 100) - (p.custo.previsao_gastos ?? 0) - p.custo.custos_lancados - comR : null
    // margem projetada (R$) = o que sobra depois de cobrir custo + comissão R$ + encargos sobre o preço.
    const margemProj = pv != null ? Math.round((pv * (1 - encFrac) - custoTotal - comR) * 100) / 100 : null
    const abaixoPiso = pv != null && precoMin != null && pv < precoMin
    return { pv, precoMin, teto, margemProj, abaixoPiso, prejuizo: abaixoPiso && pv != null && precoMin != null ? precoMin - pv : 0 }
  }, [p, precoVenda, margem])

  async function salvar() {
    const pv = numOrNull(precoVenda)
    if (pv == null || pv <= 0) { setErro('Informe o preço de venda (maior que zero).'); return }
    setSalvando(true); setErro(null)
    const { data } = await supabase.rpc('fn_veic_precificacao_salvar', { p_veiculo_id: veiculoId, p_dados: { preco_venda: String(pv), margem_alvo_pct: margem || null, observacao: obs || null }, p_user: await userId() })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro === 'preco_venda_invalido' ? 'Preço de venda inválido.' : (r?.erro || 'Falha ao salvar.')); return }
    setMsg('Preço salvo.'); setObs(''); void carregar()
  }

  async function recusarItem(it: ItemAval) {
    const motivo = window.prompt(`Recusar "${it.item}" (${brl(it.gasto_previsto)})?\nMotivo (o cliente aceita sem consertar, etc.):`)
    if (!motivo || !motivo.trim()) return
    setBusyItem(true)
    await supabase.rpc('fn_veic_avaliacao_recusar', { p_veiculo_id: veiculoId, p_resposta_id: it.resposta_id, p_motivo: motivo.trim() })
    await carregar(); setBusyItem(false)   // recarrega TUDO: o preço mínimo cai igual na ficha e aqui
  }
  async function reativarItem(it: ItemAval) {
    setBusyItem(true)
    await supabase.rpc('fn_veic_avaliacao_reativar', { p_veiculo_id: veiculoId, p_resposta_id: it.resposta_id })
    await carregar(); setBusyItem(false)
  }

  if (!p) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>{erro ?? 'Carregando precificação…'}</div>

  const v = p.veiculo
  const semVistoria = !!p.incerteza?.sem_previsao_de_gastos
  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.esp, maxWidth: 620, margin: '0 auto', padding: '18px 16px 48px' }}>
      <a href={`/dashboard/revenda/veiculo/${veiculoId}`} style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>← voltar à ficha</a>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700, marginTop: 8 }}>Precificação</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 14px' }}>{v?.marca} {v?.modelo} {v?.placa ? `· ${v.placa}` : ''}</h1>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setErro(null)}>{erro}</div>}

      {/* O QUE JÁ CUSTOU */}
      <Bloco titulo="O que este carro já custou">
        <Linha l="Aquisição" v={brl(p.custo?.aquisicao)} alerta={p.custo?.aquisicao == null ? 'sem custo de aquisição' : undefined} />
        <Linha l="Custos lançados" v={brl(p.custo?.custos_lancados)} alerta={p.incerteza?.sem_custo_lancado ? 'nenhum custo lançado' : undefined} />
        <Linha l="Previsão da vistoria" v={semVistoria ? '—' : brl(p.custo?.previsao_gastos)} alerta={semVistoria ? 'sem vistoria — o piso ignora a preparação' : undefined} />
        <div style={{ borderTop: `1px solid ${C.cream}`, marginTop: 6, paddingTop: 6 }}>
          <Linha l="Custo total" v={brl(p.custo?.custo_total)} forte />
        </div>
        {semVistoria && <a href={`/dashboard/revenda/veiculo/${veiculoId}/vistoria`} style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>→ fazer a vistoria (faz o custo da preparação aparecer)</a>}
      </Bloco>

      {/* ENCARGOS */}
      <Bloco titulo="Encargos da venda">
        <EncargoLinha l="Impostos" e={p.encargos?.impostos} />
        <EncargoLinha l="Comissão" e={p.encargos?.comissao} />
        <EncargoLinha l="Garantia" e={p.encargos?.garantia} />
        <div style={{ borderTop: `1px solid ${C.cream}`, marginTop: 6, paddingTop: 6 }}>
          <Linha l="Piso sem margem" v={p.piso_sem_margem != null ? brl(p.piso_sem_margem) : '—'} />
          <Linha l={`Preço mínimo (com margem ${p.margem_alvo_pct ?? '—'}%)`} v={p.preco_minimo != null ? brl(p.preco_minimo) : '—'} forte />
        </div>
        {p.piso_incompleto && <div style={{ background: C.amberBg, color: '#8A4B08', borderRadius: 8, padding: '7px 10px', marginTop: 8, fontSize: 12 }}>⚠️ Piso incompleto: alguns encargos não estão configurados — o mínimo pode estar otimista.</div>}
        {/* RD-65: um só lugar para os parâmetros da loja — a tela de Configuração da garagem (Onda R2). */}
        <a href="/dashboard/revenda/config" style={{ display: 'inline-block', color: C.gold, fontSize: 12.5, padding: '8px 0 0', textDecoration: 'underline' }}>⚙️ configurar encargos da loja</a>
      </Bloco>

      {/* QUERO VENDER POR */}
      <Bloco titulo="Quero vender por">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: C.espM, flex: 1 }}>Preço de venda
            <input value={precoVenda} onChange={(e) => setPrecoVenda(e.target.value)} inputMode="decimal" placeholder="R$ 0,00"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 12, fontSize: 18, border: `1px solid ${sim?.abaixoPiso ? C.red : C.border}`, borderRadius: 10, color: sim?.abaixoPiso ? C.red : C.esp }} />
          </label>
          <label style={{ fontSize: 12, color: C.espM, width: 110 }}>Margem
            <input value={margem} onChange={(e) => setMargem(e.target.value)} inputMode="decimal" placeholder="%"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 12, fontSize: 16, border: `1px solid ${C.border}`, borderRadius: 10, color: C.esp }} />
          </label>
        </div>
        {sim?.abaixoPiso && (
          <div style={{ background: C.redBg, color: C.red, borderRadius: 8, padding: '8px 11px', marginTop: 10, fontSize: 12.5 }}>
            ⚠️ Abaixo do piso: este negócio dá prejuízo de <b>{brl(sim.prejuizo)}</b> com o que se sabe hoje. Não bloqueia — mas fica registrado.
          </div>
        )}
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
          <div><div style={{ fontSize: 10.5, textTransform: 'uppercase', color: C.espM }}>Margem projetada</div><div style={{ fontSize: 18, fontWeight: 700, color: (sim?.margemProj ?? 0) >= 0 ? C.green : C.red }}>{sim?.margemProj != null ? brl(sim.margemProj) : '—'}</div></div>
          <div><div style={{ fontSize: 10.5, textTransform: 'uppercase', color: C.gold }}>Teto de compra</div><div style={{ fontSize: 18, fontWeight: 700, color: C.esp }}>{sim?.teto != null ? brl(sim.teto) : '—'}</div></div>
        </div>
        <div style={{ fontSize: 11, color: C.espL, marginTop: 6 }}>Para vender pelo preço acima com essa margem, você pode pagar até o teto na aquisição.</div>
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="observação (opcional)" style={{ width: '100%', boxSizing: 'border-box', marginTop: 12, padding: 10, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp }} />
        <button disabled={salvando} onClick={() => void salvar()} style={{ marginTop: 12, background: salvando ? C.espL : C.gold, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 22px', fontSize: 15, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer' }}>{salvando ? 'Salvando…' : 'SALVAR PREÇO'}</button>
        {p.precificado_em && <span style={{ fontSize: 11.5, color: C.espL, marginLeft: 10 }}>precificado em {brDate(p.precificado_em)}</span>}
      </Bloco>

      {/* CENÁRIOS — o carrego corrói o lucro a cada dia no pátio */}
      {cen?.cenarios && (
        <Bloco titulo="Se vender hoje × daqui a…">
          <div style={{ fontSize: 11.5, color: C.espM, marginBottom: 8 }}>Sobre {cen.preco_referencia_fonte === 'anunciado' ? 'o preço anunciado' : 'o preço mínimo sugerido'} ({brl(cen.preco_referencia)}). Carrego {brl(cen.sangria_dia)}/dia.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {cen.cenarios.map(c => (
              <div key={c.dias} style={{ flex: '1 1 100px', background: c.dias === 0 ? C.cream : C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ fontSize: 10.5, color: C.espM, fontWeight: 700 }}>{c.dias === 0 ? 'Hoje' : `+${c.dias} dias`}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: c.lucro_real == null ? C.espL : (c.lucro_real < 0 ? C.red : C.green) }}>{c.lucro_real == null ? 'não configurado' : brl(c.lucro_real)}</div>
                <div style={{ fontSize: 10, color: C.espL }}>lucro real</div>
              </div>
            ))}
          </div>
        </Bloco>
      )}

      {/* ITENS DA AVALIAÇÃO — recusar/reativar (o preço mínimo cai igual na ficha) */}
      {itens?.itens && itens.itens.length > 0 && (
        <Bloco titulo="Itens da avaliação">
          <div style={{ fontSize: 12, color: C.espM, marginBottom: 8 }}>Previsão de gastos: <b>{brl(itens.previsao?.ajustada)}</b>{Number(itens.previsao?.recusada) > 0 && <span style={{ color: C.amber }}> (recusado {brl(itens.previsao?.recusada)} de {brl(itens.previsao?.bruta)})</span>}. Recusar um item derruba a previsão e o custo — o preço mínimo cai igual em todas as telas.</div>
          {itens.itens.map(it => (
            <div key={it.resposta_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: `1px solid ${C.cream}` }}>
              <div><div style={{ fontSize: 13, textDecoration: it.recusado ? 'line-through' : 'none', color: C.esp }}>{it.item} — {brl(it.gasto_previsto)}</div>{it.recusado && it.motivo && <div style={{ fontSize: 11, color: C.amber }}>recusado: {it.motivo}</div>}</div>
              {it.recusado
                ? <button disabled={busyItem} onClick={() => void reativarItem(it)} style={{ padding: '6px 12px', background: C.white, color: C.esp, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Reativar</button>
                : <button disabled={busyItem} onClick={() => void recusarItem(it)} style={{ padding: '6px 12px', background: C.white, color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Recusar</button>}
            </div>
          ))}
        </Bloco>
      )}

      {/* GIRO DO MODELO + COMPARAÇÃO DE ESTOQUE + FRESCOR */}
      {cen?.giro_modelo && (
        <Bloco titulo="Giro e mercado do modelo">
          <div style={{ fontSize: 13, color: C.esp }}>
            {cen.giro_modelo.dias_medios == null ? 'Sem histórico de venda deste modelo ainda. ' : <>Modelos como este vendem em <b>{cen.giro_modelo.dias_medios} dias</b> (amostra {cen.giro_modelo.amostra}); este está há <b>{cen.giro_modelo.este_dias ?? '—'}</b>. </>}
            {cen.giro_modelo.recomendacao !== 'sem_historico' && <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: GIRO_LABEL[cen.giro_modelo.recomendacao].fg, background: GIRO_LABEL[cen.giro_modelo.recomendacao].bg }}>{GIRO_LABEL[cen.giro_modelo.recomendacao].t}</span>}
          </div>
          {(cen.comparacao_estoque?.length ?? 0) > 0 && (
            <div style={{ marginTop: 8, borderTop: `1px solid ${C.cream}`, paddingTop: 8 }}>
              <div style={{ fontSize: 11.5, color: C.espM, fontWeight: 600, marginBottom: 4 }}>Mesmo modelo no pátio</div>
              {cen.comparacao_estoque!.map(o => (
                <div key={o.veiculo_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
                  <span style={{ color: C.espM }}>{o.placa || 'sem placa'} · {o.dias_parado ?? '—'} dias</span><b>{o.preco_venda == null ? 'sem preço' : brl(o.preco_venda)}</b>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: C.espL, marginTop: 8 }}>Fonte do valor: manual{cen.frescor?.dias_desde != null ? ` · há ${cen.frescor.dias_desde} dias` : ''} · FIPE 🔒 (D7).</div>
        </Bloco>
      )}

      {/* SOBRE ESTE MODELO */}
      <Bloco titulo="Sobre este modelo">
        {estat?.tem_historico
          ? <div style={{ fontSize: 13, color: C.esp }}>Você teve <b>{estat.n_vendas}</b> deste modelo · <b>{estat.dias_medio_patio}</b> dias médios no pátio · margem média <b>{estat.margem_media_pct}%</b></div>
          : <div style={{ fontSize: 12.5, color: C.espM }}>Sem histórico suficiente deste modelo{estat?.n_vendas ? ` (${estat.n_vendas} venda)` : ''} — precisa de pelo menos 2 vendas.</div>}
      </Bloco>

      {/* HISTÓRICO */}
      {(p.historico?.length ?? 0) > 0 && (
        <Bloco titulo="Histórico de precificação">
          {p.historico!.map((h, i) => (
            <div key={i} style={{ borderTop: i ? `1px solid ${C.cream}` : 'none', padding: '7px 0', fontSize: 12.5 }}>
              <b>{brl(h.preco_venda)}</b> <span style={{ color: C.espM }}>· mínimo {brl(h.preco_minimo)} · margem {h.margem_alvo_pct ?? '—'}% · {brDate(h.criado_em)}</span>
              {h.observacao && <div style={{ color: C.espL, fontSize: 11.5 }}>{h.observacao}</div>}
            </div>
          ))}
        </Bloco>
      )}
    </div>
  )
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{titulo}</div>{children}</div>
}
function Linha({ l, v, alerta, forte }: { l: string; v: string; alerta?: string; forte?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: forte ? 15 : 13.5 }}>
      <span style={{ color: forte ? C.esp : C.espM, fontWeight: forte ? 700 : 400 }}>{l}{alerta && <span style={{ color: C.amber, fontSize: 11, fontWeight: 400 }}> · ⚠️ {alerta}</span>}</span>
      <span style={{ fontFamily: 'monospace', fontWeight: forte ? 700 : 400 }}>{v}</span>
    </div>
  )
}
function EncargoLinha({ l, e }: { l: string; e?: Encargo }) {
  if (!e) return null
  const naoConfig = !e.configurado || e.status === 'nao_configurado'
  // comissão por R$ (base FIPE/fixo) tem pct 0 → mostra só o R$; base preço/lucro tem %; regra traz rótulo.
  const valorTxt = naoConfig ? '—' : (e.pct ? `${e.pct}% · ${brl(e.valor)}` : brl(e.valor))
  return (
    <div style={{ padding: '3px 0', fontSize: 13.5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: C.espM }}>{l}{naoConfig && <span style={{ color: C.amber, fontSize: 11 }}> · ⚠️ não configurado</span>}</span>
        <span style={{ fontFamily: 'monospace' }}>{valorTxt}</span>
      </div>
      {e.rotulo && !naoConfig && <div style={{ fontSize: 10.5, color: C.espL, marginTop: 1 }}>{e.rotulo}{e.na_precificacao ? ' · marcada p/ precificar' : ''}</div>}
    </div>
  )
}
