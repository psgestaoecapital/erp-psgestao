'use client'
// APONTAMENTO DE HORAS (P&M). Cronômetro no job + manual → agency_timesheet. custo_total = horas ×
// custo_hora (agency_equipe). Escopo por company_id (RD-45). Tema Espresso.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type JobOpt = { id: string; titulo: string; numero: string | null }
type MembroOpt = { id: string; nome: string; custo_hora: number | null }
type Linha = { id: string; job_id: string | null; data: string; horas: number; descricao: string | null; custo_total: number | null; user_id: string | null }

export default function ApontamentoHorasPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [jobs, setJobs] = useState<JobOpt[]>([])
  const [membros, setMembros] = useState<MembroOpt[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [jobSel, setJobSel] = useState(''); const [membroSel, setMembroSel] = useState('')
  const [horasManual, setHorasManual] = useState(''); const [desc, setDesc] = useState('')
  const [rodando, setRodando] = useState<number | null>(null); const [tick, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [j, e, t] = await Promise.all([
      supabase.from('agency_jobs').select('id, titulo, numero').eq('company_id', empresa).order('created_at', { ascending: false }),
      supabase.from('agency_equipe').select('id, nome, custo_hora').eq('company_id', empresa).eq('ativo', true).order('nome'),
      supabase.from('agency_timesheet').select('id, job_id, data, horas, descricao, custo_total, user_id').eq('company_id', empresa).order('data', { ascending: false }).limit(50),
    ])
    setJobs((j.data ?? []) as JobOpt[]); setMembros((e.data ?? []) as MembroOpt[]); setLinhas((t.data ?? []) as Linha[])
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const x = setTimeout(() => setToast(null), 3000); return () => clearTimeout(x) }, [toast])
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  const custoHora = useMemo(() => Number(membros.find((m) => m.id === membroSel)?.custo_hora ?? 0), [membros, membroSel])
  const totalHorasMes = useMemo(() => linhas.reduce((s, l) => s + Number(l.horas ?? 0), 0), [linhas])
  const custoMes = useMemo(() => linhas.reduce((s, l) => s + Number(l.custo_total ?? 0), 0), [linhas])

  function iniciar() {
    if (!jobSel) { setToast('Escolha o job.'); return }
    setRodando(Date.now())
    timer.current = setInterval(() => setTick((t) => t + 1), 1000)
  }
  async function parar() {
    if (rodando == null) return
    const horas = Math.max(0.01, (Date.now() - rodando) / 3_600_000)
    if (timer.current) clearInterval(timer.current)
    setRodando(null); setTick(0)
    await gravar(Number(horas.toFixed(2)))
  }
  async function gravarManual() {
    const h = Number(horasManual)
    if (!h || h <= 0) { setToast('Informe as horas.'); return }
    await gravar(h)
  }
  async function gravar(horas: number) {
    if (!empresa || !jobSel) { setToast('Escolha o job.'); return }
    setBusy(true)
    // user_id é obrigatório; custo_total é coluna GERADA (horas × custo_hora) — não enviar.
    // fim_em setado = entrada concluída (o índice único é só p/ timer aberto: fim_em IS NULL).
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(false); setToast('Sessão expirada, entre de novo.'); return }
    const fim = new Date(); const ini = new Date(fim.getTime() - horas * 3_600_000)
    const custoPrev = Number((horas * custoHora).toFixed(2))
    const { error } = await supabase.from('agency_timesheet').insert({
      company_id: empresa, job_id: jobSel, user_id: user.id, data: fim.toISOString().slice(0, 10),
      horas, descricao: desc || null, custo_hora: custoHora || null,
      inicio_em: ini.toISOString(), fim_em: fim.toISOString(),
    })
    setBusy(false)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setHorasManual(''); setDesc(''); setToast(`Apontamento CRIADO · ${horas}h · ${brl(custoPrev)}`); void carregar()
  }

  const elapsed = rodando != null ? Math.floor((Date.now() - rodando) / 1000) : 0
  const fmtT = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  void tick

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🏭 P&amp;M · Produção</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Apontamento de horas</h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Cronômetro no job ou manual. O custo vem do custo/hora da equipe.</p>
        </header>

        <section style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 10 }}>
            <label style={lbl}>Job
              <select style={inp} value={jobSel} onChange={(e) => setJobSel(e.target.value)}>
                <option value="">Selecione…</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.titulo}</option>)}
              </select>
            </label>
            <label style={lbl}>Responsável (custo/h)
              <select style={inp} value={membroSel} onChange={(e) => setMembroSel(e.target.value)}>
                <option value="">—</option>
                {membros.map((m) => <option key={m.id} value={m.id}>{m.nome} · {brl(Number(m.custo_hora ?? 0))}/h</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            {rodando == null
              ? <button onClick={iniciar} style={btnPri}>▶ Iniciar cronômetro</button>
              : <><span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtT(elapsed)}</span><button onClick={parar} style={btnStop}>■ Parar e gravar</button></>}
            <span style={{ color: TEXTM }}>ou</span>
            <input type="number" placeholder="horas" style={{ ...inp, width: 100 }} value={horasManual} onChange={(e) => setHorasManual(e.target.value)} />
            <input placeholder="descrição" style={{ ...inp, flex: 1, minWidth: 140 }} value={desc} onChange={(e) => setDesc(e.target.value)} />
            <button disabled={busy} onClick={gravarManual} style={btnSec}>+ Manual</button>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Horas (últimas)" v={totalHorasMes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} />
          <Kpi l="Custo apontado" v={brl(custoMes)} />
          <Kpi l="Lançamentos" v={String(linhas.length)} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : linhas.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Inicie o cronômetro no job ou lance manual.</div>
          ) : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th>Data</Th><Th>Job</Th><Th>Horas</Th><Th>Custo</Th><Th>Descrição</Th></tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id} style={{ borderTop: `1px solid ${BORDA}` }}>
                      <Td>{l.data}</Td>
                      <Td>{jobs.find((j) => j.id === l.job_id)?.titulo ?? '—'}</Td>
                      <Td>{Number(l.horas).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}h</Td>
                      <Td style={{ color: GREEN, fontWeight: 600 }}>{brl(Number(l.custo_total ?? 0))}</Td>
                      <Td style={{ color: TEXTM }}>{l.descricao ?? ''}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Kpi({ l, v }: { l: string; v: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: TEXTM }}>{children}</th> }
function Td({ children, style }: { children?: React.ReactNode; style?: CSSProperties }) { return <td style={{ padding: '8px 12px', color: ESPRESSO, ...style }}>{children}</td> }
const inp: CSSProperties = { border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40, background: '#fff', color: ESPRESSO }
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: TEXTM }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnStop: CSSProperties = { border: 'none', background: '#7A1F1F', color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer', minHeight: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
