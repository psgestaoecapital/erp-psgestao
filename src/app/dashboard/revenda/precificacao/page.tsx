'use client'

// Revenda · R6b — Precificação completa (Tela 8). Escolhe um veículo do pátio e vê, da FONTE ÚNICA
// (fn_veic_precificacao_cenarios ← fn_veic_conta_do_carro/carrego, RD-65): preço mínimo sugerido,
// cenários hoje/30/60/120 (o carrego corrói o lucro), giro do modelo, comparação com o estoque do mesmo
// modelo, selo de frescor (FIPE 🔒 D7) e histórico. Recusar item da avaliação derruba a previsão/custo
// na fonte única (o preço mínimo cai igual na ficha e aqui); reativar volta. Paleta PS; sem cálculo na tela.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d: string | null | undefined) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
async function userId() { const { data: { session } } = await supabase.auth.getSession(); return session?.user?.id ?? null }

type Veic = { id: string; marca: string | null; modelo: string | null; placa: string | null; chassi: string; situacao: string }
type Cenario = { dias: number; custo_projetado: number | null; lucro_real: number | null }
type Cenarios = {
  ok: boolean; anunciado: number | null; preco_minimo_sugerido: number | null; preco_referencia: number | null; preco_referencia_fonte: string | null
  custo_real_hoje: number | null; sangria_dia: number | null; encargos_pct: number | null; dias_parado: number | null
  cenarios: Cenario[]
  giro_modelo: { dias_medios: number | null; amostra: number; este_dias: number | null; recomendacao: string }
  comparacao_estoque: { veiculo_id: string; placa: string | null; preco_venda: number | null; dias_parado: number | null }[]
  frescor: { fonte: string; precificado_em: string | null; dias_desde: number | null; fipe: { status: string; nota: string } }
  preco_minimo: { preco_minimo: number | null; custo: { previsao_gastos: number | null; custo_total: number | null } }
  historico: { preco_venda: number | null; preco_minimo: number | null; criado_em: string; observacao: string | null }[]
}
type ItemAval = { resposta_id: string; item: string; estado: string | null; descricao: string | null; gasto_previsto: number | null; recusado: boolean; motivo: string | null }
type Itens = { ok: boolean; vistoria_id: string | null; previsao: { bruta: number | null; recusada: number | null; ajustada: number | null }; itens: ItemAval[] }

const GIRO_LABEL: Record<string, { t: string; fg: string; bg: string }> = {
  acima_do_giro: { t: 'acima do giro do modelo', fg: C.red, bg: C.redBg },
  dentro_do_giro: { t: 'dentro do giro do modelo', fg: C.green, bg: C.greenBg },
  sem_historico: { t: 'sem histórico de giro', fg: C.espM, bg: C.cream },
}

export default function PrecificacaoPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [veiculos, setVeiculos] = useState<Veic[]>([])
  const [sel_v, setSelV] = useState<string>('')
  const [cen, setCen] = useState<Cenarios | null>(null)
  const [itens, setItens] = useState<Itens | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const loadVeiculos = useCallback(async () => {
    if (!companyId) { setVeiculos([]); setLoading(false); return }
    const { data } = await supabase.from('veic_veiculo').select('id, marca, modelo, placa, chassi, situacao')
      .eq('company_id', companyId).eq('ativo', true).in('situacao', ['disponivel', 'reservado', 'em_preparacao'])
      .order('modelo')
    setVeiculos((data ?? []) as Veic[]); setLoading(false)
  }, [companyId])
  useEffect(() => { void loadVeiculos() }, [loadVeiculos])

  const loadVeiculo = useCallback(async (vid: string) => {
    if (!vid) { setCen(null); setItens(null); return }
    setBusy(true)
    const [{ data: c }, { data: i }] = await Promise.all([
      supabase.rpc('fn_veic_precificacao_cenarios', { p_veiculo_id: vid }),
      supabase.rpc('fn_veic_avaliacao_itens', { p_veiculo_id: vid }),
    ])
    setCen(c as Cenarios); setItens(i as Itens); setBusy(false)
  }, [])
  useEffect(() => { if (sel_v) void loadVeiculo(sel_v) }, [sel_v, loadVeiculo])

  async function recusar(it: ItemAval) {
    const motivo = window.prompt(`Recusar "${it.item}" (${brl(it.gasto_previsto)})?\nMotivo (o cliente aceita sem consertar, etc.):`)
    if (!motivo || !motivo.trim()) return
    setBusy(true); setMsg(null)
    const { data } = await supabase.rpc('fn_veic_avaliacao_recusar', { p_veiculo_id: sel_v, p_resposta_id: it.resposta_id, p_motivo: motivo.trim(), p_user: await userId() })
    if ((data as { ok?: boolean })?.ok === false) setMsg('Não foi possível recusar o item.')
    await loadVeiculo(sel_v)
  }
  async function reativar(it: ItemAval) {
    setBusy(true); setMsg(null)
    await supabase.rpc('fn_veic_avaliacao_reativar', { p_veiculo_id: sel_v, p_resposta_id: it.resposta_id, p_user: await userId() })
    await loadVeiculo(sel_v)
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  const pm = cen?.preco_minimo
  const refFonte = cen?.preco_referencia_fonte
  const giro = cen?.giro_modelo

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '18px 16px 70px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <a href="/dashboard/revenda" style={{ color: C.gold, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>← voltar ao painel</a>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.esp, margin: '6px 0 2px' }}>Precificação</h1>
        <p style={{ color: C.espM, fontSize: 13, margin: '0 0 14px' }}>Escolha um carro do pátio: preço mínimo, o quanto o carrego come do lucro em 30/60/120 dias, o giro do modelo e a comparação com o estoque.</p>

        <select value={sel_v} onChange={e => setSelV(e.target.value)} disabled={loading}
          style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 10, background: C.white, color: C.esp, marginBottom: 16 }}>
          <option value="">{loading ? 'Carregando…' : 'Selecione um veículo do pátio…'}</option>
          {veiculos.map(v => <option key={v.id} value={v.id}>{[v.marca, v.modelo].filter(Boolean).join(' ')}{v.placa ? ` · ${v.placa}` : ''} ({v.situacao})</option>)}
        </select>

        {msg && <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{msg}</div>}

        {!sel_v ? <div style={{ color: C.espL, fontSize: 13 }}>Nenhum veículo selecionado.</div> :
         busy && !cen ? <div style={{ color: C.espM }}>Carregando…</div> :
         cen?.ok ? (
          <div style={{ display: 'grid', gap: 14 }}>
            {/* PREÇO */}
            <section style={{ background: C.esp, color: '#fff', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
                <div><div style={{ fontSize: 11, color: '#C9B79F' }}>Preço anunciado</div><div style={{ fontSize: 19, fontWeight: 800 }}>{cen.anunciado == null ? 'sem preço' : brl(cen.anunciado)}</div></div>
                <div><div style={{ fontSize: 11, color: '#C9B79F' }}>Preço mínimo sugerido</div><div style={{ fontSize: 19, fontWeight: 800, color: '#E9C77A' }}>{brl(cen.preco_minimo_sugerido)}</div></div>
                <div><div style={{ fontSize: 11, color: '#C9B79F' }}>Custo real hoje</div><div style={{ fontSize: 19, fontWeight: 800 }}>{brl(cen.custo_real_hoje)}</div></div>
              </div>
              <div style={{ fontSize: 11.5, color: '#C9B79F', marginTop: 8 }}>Cenários calculados sobre {refFonte === 'anunciado' ? 'o preço anunciado' : 'o preço mínimo sugerido'} ({brl(cen.preco_referencia)}). Carrego: {brl(cen.sangria_dia)}/dia · {cen.dias_parado ?? '—'} dias parado.</div>
            </section>

            {/* CENÁRIOS */}
            <section style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: C.esp, margin: '0 0 4px' }}>Se vender hoje × daqui a…</h2>
              <p style={{ fontSize: 12, color: C.espM, margin: '0 0 12px' }}>O carrego (ocupação + capital parado) corrói o lucro a cada dia no pátio.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
                {cen.cenarios.map(c => (
                  <div key={c.dias} style={{ background: c.dias === 0 ? C.cream : C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: C.espM, fontWeight: 700 }}>{c.dias === 0 ? 'Hoje' : `+${c.dias} dias`}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3, color: c.lucro_real == null ? C.espL : Number(c.lucro_real) < 0 ? C.red : C.green }}>
                      {c.lucro_real == null ? 'não configurado' : brl(c.lucro_real)}</div>
                    <div style={{ fontSize: 10.5, color: C.espL, marginTop: 1 }}>lucro real</div>
                  </div>
                ))}
              </div>
            </section>

            {/* GIRO + FRESCOR */}
            <section style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, display: 'grid', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 14, fontWeight: 800, color: C.esp, margin: '0 0 6px' }}>Giro do modelo</h2>
                {giro && (
                  <div style={{ fontSize: 13, color: C.esp }}>
                    {giro.dias_medios == null ? 'Sem histórico de venda deste modelo ainda.' :
                      <>Modelos como este vendem em média <b>{giro.dias_medios} dias</b> (amostra {giro.amostra}). Este está há <b>{giro.este_dias ?? '—'} dias</b>. </>}
                    {giro.recomendacao !== 'sem_historico' && (
                      <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 20, color: GIRO_LABEL[giro.recomendacao].fg, background: GIRO_LABEL[giro.recomendacao].bg }}>{GIRO_LABEL[giro.recomendacao].t}</span>)}
                  </div>
                )}
              </div>
              <div style={{ borderTop: `1px solid ${C.cream}`, paddingTop: 10 }}>
                <div style={{ fontSize: 12, color: C.espM }}>Fonte do valor: <b style={{ color: C.esp }}>manual</b>{cen.frescor.dias_desde != null ? ` · precificado há ${cen.frescor.dias_desde} dias` : ' · ainda não precificado'} · <span title={cen.frescor.fipe.nota}>FIPE 🔒 (D7)</span></div>
              </div>
            </section>

            {/* COMPARAÇÃO */}
            <section style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: C.esp, margin: '0 0 8px' }}>Mesmo modelo no pátio</h2>
              {cen.comparacao_estoque.length === 0 ? <div style={{ fontSize: 13, color: C.espL }}>Nenhum outro {cen ? '' : ''}deste modelo no estoque.</div> :
                <div style={{ display: 'grid', gap: 6 }}>
                  {cen.comparacao_estoque.map(o => (
                    <div key={o.veiculo_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, background: C.bg, borderRadius: 8, padding: '8px 10px' }}>
                      <span style={{ color: C.espM }}>{o.placa || 'sem placa'} · {o.dias_parado ?? '—'} dias</span>
                      <b style={{ color: C.esp }}>{o.preco_venda == null ? 'sem preço' : brl(o.preco_venda)}</b>
                    </div>
                  ))}
                </div>}
            </section>

            {/* AVALIAÇÃO — recusar item */}
            {itens?.ok && (itens.itens.length > 0) && (
              <section style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
                <h2 style={{ fontSize: 14, fontWeight: 800, color: C.esp, margin: '0 0 4px' }}>Itens da avaliação</h2>
                <p style={{ fontSize: 12, color: C.espM, margin: '0 0 10px' }}>
                  Previsão de gastos: <b>{brl(itens.previsao.ajustada)}</b>
                  {Number(itens.previsao.recusada) > 0 && <span style={{ color: C.amber }}> (recusado {brl(itens.previsao.recusada)} do total {brl(itens.previsao.bruta)})</span>}. Recusar um item derruba a previsão e o custo — o preço mínimo cai igual na ficha.
                </p>
                <div style={{ display: 'grid', gap: 6 }}>
                  {itens.itens.map(it => (
                    <div key={it.resposta_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: it.recusado ? C.cream : C.bg, borderRadius: 8, padding: '8px 10px', opacity: it.recusado ? 0.75 : 1 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.esp, textDecoration: it.recusado ? 'line-through' : 'none' }}>{it.item} — {brl(it.gasto_previsto)}</div>
                        {it.descricao && <div style={{ fontSize: 11.5, color: C.espM }}>{it.descricao}</div>}
                        {it.recusado && it.motivo && <div style={{ fontSize: 11.5, color: C.amber }}>recusado: {it.motivo}</div>}
                      </div>
                      {it.recusado
                        ? <button disabled={busy} onClick={() => void reativar(it)} style={{ padding: '6px 12px', background: C.white, color: C.esp, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Reativar</button>
                        : <button disabled={busy} onClick={() => void recusar(it)} style={{ padding: '6px 12px', background: C.white, color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Recusar</button>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* HISTÓRICO */}
            {(cen.historico?.length ?? 0) > 0 && (
              <section style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
                <h2 style={{ fontSize: 14, fontWeight: 800, color: C.esp, margin: '0 0 8px' }}>Histórico de precificação</h2>
                <div style={{ display: 'grid', gap: 4 }}>
                  {cen.historico.map((h, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderTop: i ? `1px solid ${C.cream}` : 'none' }}>
                      <span style={{ color: C.espM }}>{brDate(h.criado_em)}{h.observacao ? ` · ${h.observacao}` : ''}</span>
                      <span style={{ color: C.esp }}>{brl(h.preco_venda)} <span style={{ color: C.espL }}>(mín {brl(h.preco_minimo)})</span></span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : <div style={{ color: C.red, fontSize: 13 }}>Não foi possível carregar a precificação deste veículo.</div>}
      </div>
    </div>
  )
}
