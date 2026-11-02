'use client'
// COBRANÇA / FEE (P&M · Financeiro). Mensalidades recorrentes (agency_contratos ativos) a cobrar no mês.
// A tela LANÇA / AVANÇA (enviada→paga) / ESTORNA a cobrança por contrato e mostra o HISTÓRICO
// (agency_cobranca_lancamento, RD-98 p2). Estorno é soft e rastreável. O disparo real da cobrança na
// GE (erp_receber/Asaas) fica wired — post só após régua RD-53. Escopo por company_id (RD-45). Tema Espresso.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/cobranca'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const AZUL = '#1A4E8A'; const VERMELHO = '#B3261E'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const competenciaAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const compLabel = (c: string) => { const [y, m] = c.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) }

type Contrato = { id: string; cliente_id: string | null; fee_mensal: number | null; dia_vencimento: number | null }
type Cli = { id: string; nome: string; nome_fantasia: string | null }
type Lanc = { id: string; contrato_id: string; cliente_id: string | null; competencia: string; valor: number; status: string; observacao: string | null; lancado_em: string | null; enviado_em: string | null; pago_em: string | null; estornado_em: string | null; motivo_estorno: string | null }

const ST: Record<string, { rot: string; cor: string }> = {
  lancada: { rot: 'Lançada', cor: DOURADO }, enviada: { rot: 'Enviada', cor: AZUL },
  paga: { rot: 'Paga', cor: GREEN }, estornada: { rot: 'Estornada', cor: VERMELHO },
}

export default function CobrancaPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [contratos, setContratos] = useState<Contrato[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [lancs, setLancs] = useState<Lanc[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState<string | null>(null); const [toast, setToast] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [c, cl, lc] = await Promise.all([
      supabase.from('agency_contratos').select('id, cliente_id, fee_mensal, dia_vencimento').eq('company_id', empresa).eq('tipo', 'recorrente').eq('status', 'ativo'),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
      supabase.rpc('fn_agency_cobranca_listar', { p_company_id: empresa }),
    ])
    setContratos((c.data ?? []) as Contrato[]); setClientes((cl.data ?? []) as Cli[])
    const r = (lc.data ?? {}) as { ok?: boolean; lancamentos?: Lanc[] }
    setLancs(r.ok ? (r.lancamentos ?? []) : [])
    setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  const nomeCli = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }

  const comp = competenciaAtual()
  const vivaDoMes = useMemo(() => {
    const m = new Map<string, Lanc>()
    for (const l of lancs) if (l.competencia?.slice(0, 10) === comp && l.status !== 'estornada') m.set(l.contrato_id, l)
    return m
  }, [lancs, comp])

  const chamar = async (rpc: string, args: Record<string, unknown>, ok: string, key: string) => {
    setBusy(key)
    const { data, error } = await supabase.rpc(rpc, args)
    setBusy(null)
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (error || !r.ok) { setToast(`Não foi possível: ${r.erro ?? error?.message ?? 'erro'}`); return }
    setToast(ok); await carregar()
  }
  const lancar = (c: Contrato) => chamar('fn_agency_cobranca_lancar', { p_company_id: empresa, p_contrato_id: c.id, p_competencia: comp, p_valor: c.fee_mensal ?? 0 }, 'Cobrança lançada.', `lan-${c.id}`)
  const avancar = (l: Lanc, novo: string) => chamar('fn_agency_cobranca_status', { p_id: l.id, p_status: novo }, novo === 'enviada' ? 'Marcada como enviada.' : 'Marcada como paga.', `st-${l.id}`)
  const estornar = (l: Lanc) => { const motivo = window.prompt('Motivo do estorno (fica no histórico):', ''); if (motivo === null) return; void chamar('fn_agency_cobranca_estornar', { p_id: l.id, p_motivo: motivo || null }, 'Cobrança estornada.', `es-${l.id}`) }

  const mrr = useMemo(() => contratos.reduce((s, c) => s + Number(c.fee_mensal ?? 0), 0), [contratos])
  const recebidoMes = useMemo(() => lancs.filter((l) => l.competencia?.slice(0, 10) === comp && l.status === 'paga').reduce((s, l) => s + Number(l.valor ?? 0), 0), [lancs, comp])
  const abertoMes = useMemo(() => lancs.filter((l) => l.competencia?.slice(0, 10) === comp && (l.status === 'lancada' || l.status === 'enviada')).reduce((s, l) => s + Number(l.valor ?? 0), 0), [lancs, comp])
  const mesL = useMemo(() => new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), [])

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>💰 P&amp;M · Financeiro</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Cobrança / Fee<AjudaCampo chave="pm.cobranca.tela" rota={ROTA} /></h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0', textTransform: 'capitalize' }}>Mensalidades recorrentes a cobrar · {mesL}</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Contratos a cobrar" v={String(contratos.length)} chave="pm.cobranca.kpi_contratos" />
          <Kpi l="Total do mês (MRR)" v={brl(mrr)} cor={DOURADO} chave="pm.cobranca.kpi_mrr" />
          <Kpi l="Recebido no mês" v={brl(recebidoMes)} cor={GREEN} chave="pm.cobranca.kpi_recebido" />
          <Kpi l="Em aberto no mês" v={brl(abertoMes)} cor={AZUL} chave="pm.cobranca.kpi_aberto" />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : contratos.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nenhuma mensalidade recorrente ativa.</div>
          : (
            <div style={{ display: 'grid', gap: 8 }}>
              {contratos.map((c) => {
                const l = vivaDoMes.get(c.id); const s = l ? ST[l.status] : null
                return (
                  <div key={c.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 700 }}>{nomeCli(c.cliente_id)}</div>
                      <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>vencimento dia {c.dia_vencimento ?? '—'}</div>
                    </div>
                    <div style={{ fontWeight: 700, minWidth: 100, textAlign: 'right' }}>{brl(Number((l?.valor ?? c.fee_mensal) ?? 0))}</div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', minWidth: 96 }}>
                      <span title="Etapa da cobrança deste contrato no mês"
                        style={{ fontSize: 11, fontWeight: 700, color: s ? s.cor : TEXTM, border: `1px solid ${BORDA}`, borderRadius: 8, padding: '4px 8px' }}>
                        {s ? s.rot : 'A lançar'}
                      </span>
                      <AjudaCampo chave="pm.cobranca.status" rota={ROTA} />
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {!l && <>
                        <button onClick={() => void lancar(c)} disabled={busy === `lan-${c.id}`} style={btn(DOURADO)}>Lançar cobrança</button>
                        <AjudaCampo chave="pm.cobranca.acao_lancar" rota={ROTA} />
                      </>}
                      {l?.status === 'lancada' && <>
                        <button onClick={() => void avancar(l, 'enviada')} disabled={busy === `st-${l.id}`} style={btn(AZUL)}>Marcar enviada</button>
                        <AjudaCampo chave="pm.cobranca.acao_avancar" rota={ROTA} />
                      </>}
                      {l?.status === 'enviada' && <>
                        <button onClick={() => void avancar(l, 'paga')} disabled={busy === `st-${l.id}`} style={btn(GREEN)}>Marcar paga</button>
                        <AjudaCampo chave="pm.cobranca.acao_avancar" rota={ROTA} />
                      </>}
                      {l && l.status !== 'paga' && <>
                        <button onClick={() => estornar(l)} disabled={busy === `es-${l.id}`} style={btnGhost(VERMELHO)}>Estornar</button>
                        <AjudaCampo chave="pm.cobranca.acao_estornar" rota={ROTA} />
                      </>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 8px', display: 'flex', alignItems: 'center' }}>Histórico de cobranças<AjudaCampo chave="pm.cobranca.historico" rota={ROTA} /></h2>
          {lancs.length === 0 ? <div style={{ fontSize: 13, color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>Nenhuma cobrança lançada ainda.</div>
            : <div style={{ display: 'grid', gap: 6 }}>
                {lancs.map((l) => { const s = ST[l.status]
                  return (
                    <div key={l.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 10, padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                      <div style={{ flex: 1, minWidth: 150 }}>{nomeCli(l.cliente_id)}</div>
                      <div style={{ minWidth: 90, color: TEXTM, textTransform: 'capitalize' }}>{compLabel(l.competencia?.slice(0, 10) ?? '')}</div>
                      <div style={{ minWidth: 100, textAlign: 'right', fontWeight: 700, textDecoration: l.status === 'estornada' ? 'line-through' : 'none' }}>{brl(Number(l.valor))}</div>
                      <div style={{ minWidth: 90 }}><span style={{ fontSize: 11, fontWeight: 700, color: s?.cor ?? TEXTM, border: `1px solid ${BORDA}`, borderRadius: 8, padding: '3px 7px' }}>{s?.rot ?? l.status}</span></div>
                      {l.status === 'estornada' && l.motivo_estorno && <div style={{ color: VERMELHO, fontSize: 12, flexBasis: '100%' }}>Motivo do estorno: {l.motivo_estorno}</div>}
                    </div>
                  )
                })}
              </div>}
        </section>

        <p style={{ fontSize: 11, color: TEXTM, marginTop: 14, fontStyle: 'italic' }}>
          A emissão da cobrança na Gestão Empresarial (erp_receber / Asaas) é ligada após a régua de não-regressão financeira (RD-53).
        </p>
        <p style={{ fontSize: 10.5, color: TEXTM, marginTop: 6 }}>
          Origem do dado: contratos recorrentes ativos (<code>agency_contratos</code>) e o histórico de lançamentos
          (<code>agency_cobranca_lancamento</code>), por <code>fn_agency_cobranca_listar/lancar/status/estornar</code>. Escopo por empresa.
        </p>
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}
function btn(cor: string): CSSProperties { return { background: cor, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }
function btnGhost(cor: string): CSSProperties { return { background: '#fff', color: cor, border: `1px solid ${cor}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }
function Kpi({ l, v, cor, chave }: { l: string; v: string; cor?: string; chave?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
