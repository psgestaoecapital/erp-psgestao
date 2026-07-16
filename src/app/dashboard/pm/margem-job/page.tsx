'use client'
// MARGEM POR JOB (P&M). valor_job − custo (Σ agency_timesheet.custo_total) → lucro/margem. Semáforo.
// Escopo por company_id (RD-45). Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const YELLOW = '#7A5A0F'; const RED = '#7A1F1F'
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Job = { id: string; titulo: string; numero: string | null; valor_job: number | null; custo_estimado: number | null; status: string; cliente_id: string | null }
type TS = { job_id: string | null; custo_total: number | null; horas: number | null }
type Cli = { id: string; nome: string; nome_fantasia: string | null }

export default function MargemJobPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [jobs, setJobs] = useState<Job[]>([]); const [ts, setTs] = useState<TS[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      supabase.from('agency_jobs').select('id, titulo, numero, valor_job, custo_estimado, status, cliente_id').eq('company_id', empresa),
      supabase.from('agency_timesheet').select('job_id, custo_total, horas').eq('company_id', empresa),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
    ]).then(([j, t, c]) => {
      setJobs((j.data ?? []) as Job[]); setTs((t.data ?? []) as TS[]); setClientes((c.data ?? []) as Cli[]); setLoading(false)
    })
  }, [empresa])

  const nomeCli = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }
  const linhas = useMemo(() => jobs.map((j) => {
    const custoReal = ts.filter((t) => t.job_id === j.id).reduce((s, t) => s + Number(t.custo_total ?? 0), 0)
    const custo = custoReal > 0 ? custoReal : Number(j.custo_estimado ?? 0)
    const valor = Number(j.valor_job ?? 0)
    const lucro = valor - custo
    const margem = valor > 0 ? (lucro / valor) * 100 : 0
    const tom = margem >= 50 ? GREEN : margem >= 25 ? YELLOW : RED
    return { j, custo, custoReal, valor, lucro, margem, tom }
  }).sort((a, b) => a.margem - b.margem), [jobs, ts, clientes]) // eslint-disable-line react-hooks/exhaustive-deps

  const tot = useMemo(() => ({
    valor: linhas.reduce((s, l) => s + l.valor, 0),
    custo: linhas.reduce((s, l) => s + l.custo, 0),
    lucro: linhas.reduce((s, l) => s + l.lucro, 0),
  }), [linhas])
  const margemGeral = tot.valor > 0 ? (tot.lucro / tot.valor) * 100 : 0

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🏭 P&amp;M · Produção</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Margem por Job</h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Valor − custo (horas apontadas × custo/hora). Custo estimado quando não há apontamento.</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Valor total" v={brl(tot.valor)} />
          <Kpi l="Custo total" v={brl(tot.custo)} />
          <Kpi l="Lucro" v={brl(tot.lucro)} cor={tot.lucro >= 0 ? GREEN : RED} />
          <Kpi l="Margem geral" v={`${margemGeral.toFixed(1)}%`} cor={margemGeral >= 50 ? GREEN : margemGeral >= 25 ? YELLOW : RED} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : linhas.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Sem jobs ainda.</div>
          : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th>Job</Th><Th>Cliente</Th><Th>Valor</Th><Th>Custo</Th><Th>Lucro</Th><Th>Margem</Th></tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.j.id} style={{ borderTop: `1px solid ${BORDA}` }}>
                      <Td><b>{l.j.titulo}</b></Td>
                      <Td style={{ color: TEXTM }}>{nomeCli(l.j.cliente_id)}</Td>
                      <Td>{brl(l.valor)}</Td>
                      <Td>{brl(l.custo)}{l.custoReal === 0 && <span style={{ fontSize: 10, color: TEXTM }}> (est.)</span>}</Td>
                      <Td style={{ color: l.lucro >= 0 ? GREEN : RED, fontWeight: 700 }}>{brl(l.lucro)}</Td>
                      <Td><span style={{ fontWeight: 700, color: l.tom }}>● {l.margem.toFixed(1)}%</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
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
