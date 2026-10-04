'use client'
// MARGEM POR JOB (P&M). valor_job − custo (Σ agency_timesheet.custo_total) → lucro/margem. Semáforo.
// CEO 01/10: sem custo/hora não há lucro — a tela pede para cadastrar o custo da hora (regra em src/lib/pm/margem.ts).
// Escopo por company_id (RD-45). Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { calcularMargem, totaisMargem, type ApontamentoMargem } from '@/lib/pm/margem'
import { carregarCustosEquipe } from '@/lib/pm/equipeCustos'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const YELLOW = '#7A5A0F'; const RED = '#7A1F1F'
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Job = { id: string; titulo: string; numero: string | null; valor_job: number | null; custo_estimado: number | null; status: string; cliente_id: string | null }
type Cli = { id: string; nome: string; nome_fantasia: string | null }
// custo_hora por pessoa só para quem vê salário (fn_pm_equipe_custos, LGPD 03/10); os demais veem só os totais
type Membro = { id: string; nome: string; custo_hora: number | null }

// onde se cadastra o custo da hora: tela Equipe do P&M (custo/hora por pessoa)
const ROTA_CUSTO_HORA = '/dashboard/pm/equipe'

export default function MargemJobPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [jobs, setJobs] = useState<Job[]>([]); const [ts, setTs] = useState<ApontamentoMargem[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [membros, setMembros] = useState<Membro[]>([])
  const [podeVer, setPodeVer] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      supabase.from('agency_jobs').select('id, titulo, numero, valor_job, custo_estimado, status, cliente_id').eq('company_id', empresa),
      supabase.from('agency_timesheet').select('job_id, horas, custo_hora, custo_total').eq('company_id', empresa),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
      supabase.from('agency_equipe').select('id, nome').eq('company_id', empresa).eq('ativo', true).order('nome'),
      carregarCustosEquipe(supabase, empresa),
    ]).then(([j, t, c, m, custos]) => {
      setJobs((j.data ?? []) as Job[]); setTs((t.data ?? []) as ApontamentoMargem[]); setClientes((c.data ?? []) as Cli[])
      setPodeVer(custos.podeVer)
      setMembros(((m.data ?? []) as { id: string; nome: string }[]).map((x) => ({ ...x, custo_hora: custos.custos.get(x.id) ?? null })))
      setLoading(false)
    })
  }, [empresa])

  const nomeCli = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }
  const linhas = useMemo(() => jobs.map((j) => {
    const m = calcularMargem(j, ts)
    const tom = m.margem == null ? TEXTM : m.margem >= 50 ? GREEN : m.margem >= 25 ? YELLOW : RED
    return { j, ...m, tom }
  }).sort((a, b) => (a.margem ?? -1e9) - (b.margem ?? -1e9)), [jobs, ts])

  const tot = useMemo(() => totaisMargem(linhas), [linhas])
  // quem está sem custo/hora é dado por pessoa: só aparece para quem vê salário
  const semCustoHora = podeVer ? membros.filter((m) => !(Number(m.custo_hora ?? 0) > 0)).map((m) => m.nome) : []

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🏭 P&amp;M · Produção</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Margem por Job</h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Valor − custo (horas apontadas × custo/hora). Custo estimado quando não há apontamento.</p>
        </header>

        {(tot.semCustoHora > 0 || semCustoHora.length > 0) && (
          <div data-testid="margem-aviso-custo-hora" style={{ background: '#FFF7E6', border: `1px solid ${DOURADO}`, borderRadius: 12, padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
            <b>Cadastre o custo da hora da equipe.</b>{' '}
            {tot.semCustoHora > 0
              ? <>Há {tot.semCustoHora === 1 ? '1 job com horas apontadas' : `${tot.semCustoHora} jobs com horas apontadas`} por quem não tem custo/hora — sem isso o lucro sairia igual ao valor do job.</>
              : <>Sem custo/hora, as horas apontadas por essas pessoas não entram no custo do job.</>}
            {semCustoHora.length > 0 && <div style={{ color: TEXTM, marginTop: 4 }}>Sem custo/hora: {semCustoHora.join(', ')}.</div>}
            <div style={{ marginTop: 8 }}>
              <a href={ROTA_CUSTO_HORA} data-testid="margem-cadastrar-custo-hora" style={{ display: 'inline-block', background: ESPRESSO, color: '#fff', borderRadius: 8, padding: '6px 12px', fontWeight: 700, textDecoration: 'none' }}>
                Cadastrar custo da hora →
              </a>
              <span style={{ color: TEXTM, marginLeft: 8, fontSize: 12 }}>Tela Equipe: em cada pessoa, campo &quot;Custo/hora (R$)&quot;.</span>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 6 }}>
          <Kpi l="Valor total" v={brl(tot.valor)} />
          <Kpi l="Custo total" v={brl(tot.custo)} />
          <Kpi l="Lucro" v={brl(tot.lucro)} cor={tot.lucro >= 0 ? GREEN : RED} />
          <Kpi l="Margem geral" v={`${tot.margem.toFixed(1)}%`} cor={tot.margem >= 50 ? GREEN : tot.margem >= 25 ? YELLOW : RED} />
        </div>
        {(tot.semCustoHora + tot.semCusto) > 0 && (
          <div style={{ fontSize: 12, color: TEXTM, marginBottom: 14 }} data-testid="margem-fora-do-total">
            {tot.semCustoHora + tot.semCusto} job(s) sem custo completo não entram no lucro nem na margem acima.
          </div>
        )}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : linhas.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Sem jobs ainda.</div>
          : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th>Job</Th><Th>Cliente</Th><Th>Valor</Th><Th>Custo</Th><Th>Lucro</Th><Th>Margem</Th></tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.j.id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`margem-job-${l.j.id}`}>
                      <Td><b>{l.j.titulo}</b></Td>
                      <Td style={{ color: TEXTM }}>{nomeCli(l.j.cliente_id)}</Td>
                      <Td>{brl(l.valor)}</Td>
                      {l.situacao === 'ok' ? (<>
                        <Td>{brl(l.custo)}{l.estimado && <span style={{ fontSize: 10, color: TEXTM }}> (est.)</span>}</Td>
                        <Td style={{ color: (l.lucro ?? 0) >= 0 ? GREEN : RED, fontWeight: 700 }}>{brl(l.lucro ?? 0)}</Td>
                        <Td><span style={{ fontWeight: 700, color: l.tom }}>● {(l.margem ?? 0).toFixed(1)}%</span></Td>
                      </>) : l.situacao === 'sem_custo_hora' ? (
                        <Td colSpan={3} style={{ color: YELLOW }}>
                          <a href={ROTA_CUSTO_HORA} style={{ color: YELLOW, fontWeight: 700 }}>Cadastre o custo da hora da equipe</a>
                          {' '}— {l.horasSemCusto.toLocaleString('pt-BR')} h apontada(s) sem custo/hora
                        </Td>
                      ) : (
                        <Td colSpan={3} style={{ color: TEXTM }}>Sem custo lançado — aponte as horas do job ou informe o custo estimado</Td>
                      )}
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
function Td({ children, style, colSpan }: { children?: React.ReactNode; style?: CSSProperties; colSpan?: number }) { return <td colSpan={colSpan} style={{ padding: '8px 12px', color: ESPRESSO, ...style }}>{children}</td> }
