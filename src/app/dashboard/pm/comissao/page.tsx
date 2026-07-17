'use client'
// COMISSÃO (P&M · Financeiro). Sobre agency_comissao. Fechamento por competência. Escopo por
// company_id (RD-45). Elo erp_pagar (lancamento_id) fica wired — post só após régua RD-53. Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const STATUS: Record<string, { l: string; cor: string }> = {
  prevista: { l: 'Prevista', cor: '#FFF3D6' }, a_pagar: { l: 'A pagar', cor: '#FCE9C2' },
  paga: { l: 'Paga', cor: '#DCEFD7' }, cancelada: { l: 'Cancelada', cor: '#F4D6D6' },
}
const stCfg = (v: string) => STATUS[v] ?? { l: v, cor: OFFWHITE }
const compL = (d: string | null) => { if (!d) return '—'; const [y, m] = d.slice(0, 7).split('-'); return `${m}/${y}` }

type Comissao = { id: string; job_id: string | null; vendedor_id: string | null; base_valor: number | null; percentual: number | null; valor_comissao: number | null; competencia: string | null; status: string; lancamento_id: string | null }
type JobOpt = { id: string; titulo: string }

export default function ComissaoPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [comissoes, setComissoes] = useState<Comissao[]>([]); const [jobs, setJobs] = useState<JobOpt[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [c, j] = await Promise.all([
      supabase.from('agency_comissao').select('*').eq('company_id', empresa).order('competencia', { ascending: false }),
      supabase.from('agency_jobs').select('id, titulo').eq('company_id', empresa),
    ])
    setComissoes((c.data ?? []) as Comissao[]); setJobs((j.data ?? []) as JobOpt[]); setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  const jobTit = (id: string | null) => jobs.find((x) => x.id === id)?.titulo ?? '—'

  const kpis = useMemo(() => ({
    prevista: comissoes.filter((c) => c.status === 'prevista').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
    aPagar: comissoes.filter((c) => c.status === 'a_pagar').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
    paga: comissoes.filter((c) => c.status === 'paga').reduce((s, c) => s + Number(c.valor_comissao ?? 0), 0),
  }), [comissoes])

  async function fechar() {
    if (!empresa) return
    const prevs = comissoes.filter((c) => c.status === 'prevista')
    if (prevs.length === 0) { setToast('Nenhuma comissão prevista pra fechar.'); return }
    if (!confirm(`Fechar ${prevs.length} comissão(ões) prevista(s) → A PAGAR?`)) return
    setBusy(true)
    await supabase.from('agency_comissao').update({ status: 'a_pagar' }).eq('company_id', empresa).eq('status', 'prevista')
    setBusy(false); setToast('Comissões fechadas → A PAGAR. (lançamento no erp_pagar após régua RD-53)'); void carregar()
  }
  async function marcarPaga(c: Comissao) {
    await supabase.from('agency_comissao').update({ status: 'paga' }).eq('id', c.id)
    setToast('Comissão marcada como PAGA.'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>💰 P&amp;M · Financeiro</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Comissão</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Por vendedor/competência. Fechar leva pra "a pagar" (vira erp_pagar após régua).</p>
          </div>
          <button disabled={busy} onClick={fechar} style={btnPri}>Fechar previstas</button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Prevista" v={brl(kpis.prevista)} />
          <Kpi l="A pagar" v={brl(kpis.aPagar)} cor={DOURADO} />
          <Kpi l="Paga" v={brl(kpis.paga)} cor={GREEN} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : comissoes.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Sem comissões no período.</div>
          : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th>Competência</Th><Th>Job</Th><Th>Base</Th><Th>%</Th><Th>Comissão</Th><Th>Status</Th><Th></Th></tr></thead>
                <tbody>
                  {comissoes.map((c) => {
                    const cfg = stCfg(c.status)
                    return (
                      <tr key={c.id} style={{ borderTop: `1px solid ${BORDA}` }}>
                        <Td>{compL(c.competencia)}</Td>
                        <Td>{jobTit(c.job_id)}</Td>
                        <Td>{brl(Number(c.base_valor ?? 0))}</Td>
                        <Td>{Number(c.percentual ?? 0)}%</Td>
                        <Td style={{ fontWeight: 700 }}>{brl(Number(c.valor_comissao ?? 0))}</Td>
                        <Td><span style={{ fontSize: 11, fontWeight: 700, background: cfg.cor, padding: '2px 8px', borderRadius: 999 }}>{cfg.l}</span></Td>
                        <Td>{c.status === 'a_pagar' && <button onClick={() => marcarPaga(c)} style={btnOk}>Marcar paga</button>}</Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        <p style={{ fontSize: 11, color: TEXTM, marginTop: 14, fontStyle: 'italic' }}>
          O lançamento da comissão no contas a pagar da GE (erp_pagar) é ligado após a régua de não-regressão financeira (RD-53).
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
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: TEXTM }}>{children}</th> }
function Td({ children, style }: { children?: React.ReactNode; style?: CSSProperties }) { return <td style={{ padding: '8px 12px', color: ESPRESSO, ...style }}>{children}</td> }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnOk: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
