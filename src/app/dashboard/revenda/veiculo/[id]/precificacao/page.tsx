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
  red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d?: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const numOrNull = (s: string): number | null => { const n = Number(String(s).replace(',', '.')); return s.trim() !== '' && Number.isFinite(n) ? n : null }

type Encargo = { pct: number | null; valor: number | null; configurado: boolean }
type Precif = {
  ok?: boolean
  veiculo?: { id: string; marca: string | null; modelo: string | null; placa: string | null }
  custo?: { aquisicao: number | null; custos_lancados: number; previsao_gastos: number | null; custo_base: number; custo_total: number }
  encargos?: { impostos: Encargo; comissao: Encargo; garantia: Encargo }
  preco_minimo?: number; preco_sugerido?: number | null; margem_alvo_pct?: number | null
  preco_venda?: number | null; precificado_em?: string | null; margem_projetada?: number | null
  incerteza?: Record<string, boolean>; piso_incompleto?: boolean
  historico?: { preco_venda: number | null; preco_minimo: number | null; margem_alvo_pct: number | null; premissas: Record<string, unknown> | null; observacao: string | null; criado_em: string }[]
}
type Estat = { ok?: boolean; tem_historico?: boolean; n_vendas?: number; dias_medio_patio?: number; margem_media_pct?: number }
type Cfg = { semaforo_verde_ate_dias?: number; semaforo_amarelo_ate_dias?: number; margem_alvo_pct?: number; impostos_venda_pct?: number | null; comissao_venda_pct?: number | null; provisao_garantia_pct?: number | null }

export default function PrecificacaoPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const params = useParams()
  const veiculoId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params!.id[0] : ''
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [p, setP] = useState<Precif | null>(null)
  const [estat, setEstat] = useState<Estat | null>(null)
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [precoVenda, setPrecoVenda] = useState('')
  const [margem, setMargem] = useState('')
  const [obs, setObs] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [cfgAberto, setCfgAberto] = useState(false)

  async function userId() { const { data: { user } } = await supabase.auth.getUser(); return user?.id ?? null }

  const carregar = useCallback(async () => {
    if (!veiculoId) return
    const { data: veic } = await supabase.from('veic_veiculo').select('company_id, marca, modelo').eq('id', veiculoId).maybeSingle()
    const comp = (veic as { company_id?: string; marca?: string; modelo?: string } | null)?.company_id ?? null
    setCompanyId(comp)
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
      const { data: cf } = await supabase.from('veic_config').select('*').eq('company_id', comp).maybeSingle()
      setCfg((cf as Cfg | null) ?? null)
    }
  }, [veiculoId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  // simulação client-side (RD-42: não bate no servidor a cada tecla). Mesma fórmula da fn_..._simular.
  const sim = useMemo(() => {
    if (!p?.custo) return null
    const pv = numOrNull(precoVenda)
    const mg = numOrNull(margem) ?? 0
    const imp = p.encargos?.impostos.pct ?? 0
    const com = p.encargos?.comissao.pct ?? 0
    const gar = p.encargos?.garantia.pct ?? 0
    const somaPct = mg + imp + com + gar
    const custoTotal = p.custo.custo_total
    const encargos = custoTotal * (imp + com + gar) / 100
    const precoMin = custoTotal + encargos
    const teto = pv != null ? (pv / (1 + somaPct / 100)) - (p.custo.previsao_gastos ?? 0) - p.custo.custos_lancados : null
    const margemProj = pv != null ? pv - precoMin : null
    const abaixoPiso = pv != null && pv < precoMin
    return { pv, precoMin, teto, margemProj, abaixoPiso, prejuizo: abaixoPiso && pv != null ? precoMin - pv : 0 }
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

  if (!p) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>{erro ?? 'Carregando precificação…'}</div>

  const v = p.veiculo
  const semVistoria = !!p.incerteza?.sem_previsao_de_gastos
  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.esp, maxWidth: 620, margin: '0 auto', padding: '18px 16px 48px' }}>
      <a href={`/dashboard/revenda/veiculo/${veiculoId}`} style={{ fontSize: 12, color: C.blue, textDecoration: 'none' }}>← voltar à ficha</a>
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
        {semVistoria && <a href={`/dashboard/revenda/veiculo/${veiculoId}/vistoria`} style={{ fontSize: 12, color: C.blue, textDecoration: 'none' }}>→ fazer a vistoria (faz o custo da preparação aparecer)</a>}
      </Bloco>

      {/* ENCARGOS */}
      <Bloco titulo="Encargos da venda">
        <EncargoLinha l="Impostos" e={p.encargos?.impostos} />
        <EncargoLinha l="Comissão" e={p.encargos?.comissao} />
        <EncargoLinha l="Garantia" e={p.encargos?.garantia} />
        <div style={{ borderTop: `1px solid ${C.cream}`, marginTop: 6, paddingTop: 6 }}>
          <Linha l="Preço mínimo" v={brl(p.preco_minimo)} forte />
        </div>
        {p.piso_incompleto && <div style={{ background: C.amberBg, color: '#8A4B08', borderRadius: 8, padding: '7px 10px', marginTop: 8, fontSize: 12 }}>⚠️ Piso incompleto: alguns encargos não estão configurados — o mínimo pode estar otimista.</div>}
        <button onClick={() => setCfgAberto((x) => !x)} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 12.5, cursor: 'pointer', padding: '8px 0 0', textDecoration: 'underline' }}>⚙️ configurar encargos da loja</button>
        {cfgAberto && companyId && <ConfigEncargos companyId={companyId} cfg={cfg} onSaved={() => { setMsg('Encargos configurados.'); setCfgAberto(false); void carregar() }} onErro={setErro} />}
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

function ConfigEncargos({ companyId, cfg, onSaved, onErro }: { companyId: string; cfg: Cfg | null; onSaved: () => void; onErro: (m: string) => void }) {
  const [imp, setImp] = useState(cfg?.impostos_venda_pct != null ? String(cfg.impostos_venda_pct) : '')
  const [com, setCom] = useState(cfg?.comissao_venda_pct != null ? String(cfg.comissao_venda_pct) : '')
  const [gar, setGar] = useState(cfg?.provisao_garantia_pct != null ? String(cfg.provisao_garantia_pct) : '')
  const [mg, setMg] = useState(cfg?.margem_alvo_pct != null ? String(cfg.margem_alvo_pct) : '')
  const [busy, setBusy] = useState(false)
  async function salvar() {
    setBusy(true)
    // escrita por RPC com guard de tenant (padrão da vertical). A RPC faz upsert e preserva
    // o semáforo (Onda 1) e a margem existentes; vazio nos encargos = NULL ("não configurado").
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.rpc('fn_veic_config_salvar', {
      p_company_id: companyId,
      p_dados: { impostos_venda_pct: imp, comissao_venda_pct: com, provisao_garantia_pct: gar, margem_alvo_pct: mg },
      p_user: user?.id ?? null,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { onErro(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (r?.erro || 'Falha ao configurar encargos.')); return }
    onSaved()
  }
  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 9, fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp }
  return (
    <div style={{ background: C.cream, borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 11.5, color: C.espM, marginBottom: 8 }}>Percentuais da loja (deixe em branco o que não se aplica — a tela avisa o que falta, nunca finge zero).</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ fontSize: 11.5, color: C.espM }}>Impostos %<input value={imp} onChange={(e) => setImp(e.target.value)} inputMode="decimal" style={inp} /></label>
        <label style={{ fontSize: 11.5, color: C.espM }}>Comissão %<input value={com} onChange={(e) => setCom(e.target.value)} inputMode="decimal" style={inp} /></label>
        <label style={{ fontSize: 11.5, color: C.espM }}>Garantia %<input value={gar} onChange={(e) => setGar(e.target.value)} inputMode="decimal" style={inp} /></label>
        <label style={{ fontSize: 11.5, color: C.espM }}>Margem alvo %<input value={mg} onChange={(e) => setMg(e.target.value)} inputMode="decimal" style={inp} /></label>
      </div>
      <button disabled={busy} onClick={() => void salvar()} style={{ marginTop: 10, background: busy ? C.espL : C.esp, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Salvando…' : 'Salvar encargos'}</button>
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
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 13.5 }}>
      <span style={{ color: C.espM }}>{l}{!e.configurado && <span style={{ color: C.amber, fontSize: 11 }}> · ⚠️ não configurado</span>}</span>
      <span style={{ fontFamily: 'monospace' }}>{e.configurado ? `${e.pct}% · ${brl(e.valor)}` : '—'}</span>
    </div>
  )
}
