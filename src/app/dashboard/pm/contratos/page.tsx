'use client'
// CONTRATOS (P&M · Financeiro). Sobre agency_contratos. Recorrente (fee) ou projeto. Escopo por
// company_id (RD-45). Integração GE (erp_receber) fica como AÇÃO wired — post automático só após
// régua RD-53 + autorização (não sujar o financeiro real na demo). Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const RED = '#7A1F1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const STATUS: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: '#F0E9DE' }, ativo: { l: 'Ativo', cor: '#DCEFD7' },
  suspenso: { l: 'Suspenso', cor: '#FFF3D6' }, encerrado: { l: 'Encerrado', cor: '#F4D6D6' },
}
const stCfg = (v: string) => STATUS[v] ?? { l: v, cor: OFFWHITE }

type Contrato = {
  id: string; cliente_id: string | null; tipo: string; fee_mensal: number | null; valor_projeto: number | null
  dia_vencimento: number | null; data_inicio: string | null; status: string; documentacao_ok: boolean; lancamento_id: string | null
}
type Cli = { id: string; nome: string; nome_fantasia: string | null }
// Escopo do contrato (moat): contratado × realizado por tipo_servico.
type EscopoInfo = { itens_total: number; itens_estourados: number; escopo_status: string }
type RealItem = { tipo_servico: string; quantidade_contratada: number; solicitados: number; entregues: number; ultrapassou: boolean }
type RealState = { loading: boolean; itens: RealItem[]; nao_mapeados: { tipo: string; qtd: number }[]; erro?: string }

export default function ContratosPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [contratos, setContratos] = useState<Contrato[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [escopoMap, setEscopoMap] = useState<Record<string, EscopoInfo>>({})
  const [expand, setExpand] = useState<Record<string, RealState>>({})
  const [loading, setLoading] = useState(true); const [toast, setToast] = useState<string | null>(null)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [c, cl, esc] = await Promise.all([
      supabase.from('agency_contratos').select('*').eq('company_id', empresa).order('criado_em', { ascending: false }),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
      supabase.rpc('fn_agency_contrato_listar', { p_company_id: empresa }),
    ])
    const em: Record<string, EscopoInfo> = {}
    for (const r of (esc.data ?? []) as { contrato_id: string; itens_total: number; itens_estourados: number; escopo_status: string }[]) {
      em[r.contrato_id] = { itens_total: r.itens_total, itens_estourados: r.itens_estourados, escopo_status: r.escopo_status }
    }
    setContratos((c.data ?? []) as Contrato[]); setClientes((cl.data ?? []) as Cli[]); setEscopoMap(em); setExpand({}); setLoading(false)
  }

  async function toggleEscopo(id: string) {
    if (expand[id]) { setExpand((m) => { const n = { ...m }; delete n[id]; return n }); return }
    setExpand((m) => ({ ...m, [id]: { loading: true, itens: [], nao_mapeados: [] } }))
    const { data, error } = await supabase.rpc('fn_agency_contrato_realizado', { p_contrato_id: id })
    const j = data as { ok?: boolean; erro?: string; itens?: RealItem[]; nao_mapeados?: { tipo: string; qtd: number }[] } | null
    if (error || !j?.ok) { setExpand((m) => ({ ...m, [id]: { loading: false, itens: [], nao_mapeados: [], erro: error?.message ?? j?.erro ?? 'falhou' } })); return }
    setExpand((m) => ({ ...m, [id]: { loading: false, itens: j.itens ?? [], nao_mapeados: j.nao_mapeados ?? [] } }))
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  const nomeCli = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }

  const kpis = useMemo(() => ({
    ativos: contratos.filter((c) => c.status === 'ativo').length,
    mrr: contratos.filter((c) => c.status === 'ativo' && c.tipo === 'recorrente').reduce((s, c) => s + Number(c.fee_mensal ?? 0), 0),
  }), [contratos])

  async function mudarStatus(c: Contrato, status: string) {
    await supabase.from('agency_contratos').update({ status, atualizado_em: new Date().toISOString() }).eq('id', c.id)
    setToast(`Contrato ALTERADO para ${stCfg(status).l}.`); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1050, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>💰 P&amp;M · Financeiro</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Contratos</h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Recorrente (fee) ou projeto. Aprovar uma proposta gera o contrato.</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Contratos ativos" v={String(kpis.ativos)} />
          <Kpi l="MRR (fee recorrente)" v={brl(kpis.mrr)} cor={DOURADO} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : contratos.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nenhum contrato. Aprovar uma proposta gera o contrato.</div>
          : (
            <div style={{ display: 'grid', gap: 8 }}>
              {contratos.map((c) => {
                const cfg = stCfg(c.status)
                const esc = escopoMap[c.id]
                const estourado = esc && esc.itens_estourados > 0
                const exp = expand[c.id]
                return (
                  <div key={c.id} style={{ background: '#fff', border: `1px solid ${estourado ? RED : BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontWeight: 700 }}>{nomeCli(c.cliente_id)} <span style={{ color: TEXTM, fontWeight: 400 }}>· {c.tipo === 'recorrente' ? 'recorrente' : 'projeto'}</span></div>
                        <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>
                          {c.tipo === 'recorrente' ? `${brl(Number(c.fee_mensal ?? 0))}/mês · venc. dia ${c.dia_vencimento ?? '—'}` : brl(Number(c.valor_projeto ?? 0))}
                          {c.data_inicio ? ` · desde ${c.data_inicio}` : ''}{c.documentacao_ok ? ' · doc ✓' : ''}
                        </div>
                      </div>
                      {esc && esc.itens_total > 0 && (
                        <button onClick={() => void toggleEscopo(c.id)}
                          title="Contratado × realizado (escopo)"
                          style={{ fontSize: 11, fontWeight: 700, color: estourado ? RED : GREEN, background: estourado ? '#F9E4E4' : '#DCEFD7', border: `1px solid ${estourado ? RED : GREEN}`, borderRadius: 999, padding: '3px 10px', cursor: 'pointer' }}>
                          {exp ? '▾ ' : '▸ '}{estourado ? `escopo estourado (${esc.itens_estourados})` : `escopo ok · ${esc.itens_total} ${esc.itens_total === 1 ? 'item' : 'itens'}`}
                        </button>
                      )}
                      <span style={{ fontSize: 11, fontWeight: 700, color: ESPRESSO, background: cfg.cor, padding: '3px 10px', borderRadius: 999 }}>{cfg.l}</span>
                      {c.status === 'ativo'
                        ? <button onClick={() => mudarStatus(c, 'suspenso')} style={btnSec}>Suspender</button>
                        : c.status === 'suspenso' ? <button onClick={() => mudarStatus(c, 'ativo')} style={btnOk}>Reativar</button>
                        : c.status === 'rascunho' ? <button onClick={() => mudarStatus(c, 'ativo')} style={btnOk}>Ativar</button> : null}
                      <span title="Gera receita na GE — habilitado após a régua financeira (RD-53)"
                        style={{ fontSize: 11, color: c.lancamento_id ? GREEN : TEXTM, border: `1px dashed ${BORDA}`, borderRadius: 8, padding: '4px 8px' }}>
                        {c.lancamento_id ? '→ receita na GE ✓' : '→ receita na GE (após régua)'}
                      </span>
                    </div>

                    {exp && (
                      <div style={{ marginTop: 10, borderTop: `1px solid ${BORDA}`, paddingTop: 10 }}>
                        {exp.loading ? <div style={{ fontSize: 12, color: TEXTM }}>Carregando escopo…</div>
                          : exp.erro ? <div style={{ fontSize: 12, color: RED }}>Erro: {exp.erro}</div>
                          : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: TEXTM, fontWeight: 700 }}>Contratado × realizado</div>
                              {exp.itens.map((it) => (
                                <div key={it.tipo_servico} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, alignItems: 'center' }}>
                                  <span style={{ color: ESPRESSO }}>{it.ultrapassou ? '🔴' : '🟢'} {it.tipo_servico}</span>
                                  <span style={{ color: it.ultrapassou ? RED : TEXTM, fontVariantNumeric: 'tabular-nums' }}>
                                    {it.solicitados} solicitado(s){it.entregues !== it.solicitados ? ` · ${it.entregues} entregue(s)` : ''} de {Number(it.quantidade_contratada)} contratado(s)
                                    {it.ultrapassou ? ' · ULTRAPASSOU' : ''}
                                  </span>
                                </div>
                              ))}
                              {exp.itens.length === 0 && <div style={{ fontSize: 12, color: TEXTM }}>Sem itens de escopo.</div>}
                              {exp.nao_mapeados.length > 0 && (
                                <div style={{ fontSize: 11, color: TEXTM, marginTop: 2 }}>
                                  Jobs fora do escopo: {exp.nao_mapeados.map((n) => `${n.qtd} ${n.tipo}`).join(' · ')}
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        <p style={{ fontSize: 11, color: TEXTM, marginTop: 14, fontStyle: 'italic' }}>
          A geração de receita recorrente na Gestão Empresarial (erp_receber) é ligada após a régua de não-regressão financeira (RD-53).
        </p>
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Kpi({ l, v, cor }: { l: string; v: string; cor?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
const btnOk: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
