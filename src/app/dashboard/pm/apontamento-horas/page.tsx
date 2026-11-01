'use client'
// APONTAMENTO DE HORAS (P&M). Cronômetro no job + manual → agency_timesheet. custo_total = horas ×
// custo_hora (agency_equipe). Escopo por company_id (RD-45). Tema Espresso.
// LGPD (03/10): o custo/hora por pessoa vem de fn_pm_equipe_custos (só para quem vê salário); os demais apontam as
// horas sem ver o custo de ninguém — o apontamento sai sem custo/hora e a Margem avisa.
// 1 toque (onda 2 da P&M da Pdois, Parte S, atrito 18): o link "Lançar horas"/"apontar" (?job=) já abre com o job
// escolhido e os atalhos +15 min/+30 min/+1 h/+2 h gravam direto, sem digitar.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { carregarCustosEquipe } from '@/lib/pm/equipeCustos'
import { ATALHOS_HORAS, jobDoLink } from '@/lib/pm/apontamentoRapido'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'
const AMBER = '#8a6a10'; const AMBERBG = '#FDF4E0'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type JobOpt = { id: string; titulo: string; numero: string | null }
type MembroOpt = { id: string; nome: string; custo_hora: number | null }
type Linha = { id: string; job_id: string | null; data: string; horas: number; descricao: string | null; custo_total: number | null; user_id: string | null; etapa_tipo?: string | null }

export default function ApontamentoHorasPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [jobs, setJobs] = useState<JobOpt[]>([])
  const [membros, setMembros] = useState<MembroOpt[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [podeVerCusto, setPodeVerCusto] = useState(false)
  const [jobSel, setJobSel] = useState(''); const [membroSel, setMembroSel] = useState('')
  const [horasManual, setHorasManual] = useState(''); const [desc, setDesc] = useState('')
  const [rodando, setRodando] = useState<number | null>(null); const [tick, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)
  // mapa id→job p/ a tabela resolver o nome mesmo quando o job não está na lista do seletor (corte de 1000 do PostgREST)
  const [jobMap, setJobMap] = useState<Map<string, JobOpt>>(new Map())
  const [ocultarRuido, setOcultarRuido] = useState(true)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [j, e, t, c] = await Promise.all([
      supabase.from('agency_jobs').select('id, titulo, numero').eq('company_id', empresa).is('excluido_em', null).order('created_at', { ascending: false }),
      supabase.from('agency_equipe').select('id, nome').eq('company_id', empresa).eq('ativo', true).order('nome'),
      supabase.from('agency_timesheet').select('id, job_id, data, horas, descricao, user_id, etapa_tipo').eq('company_id', empresa).is('excluido_em', null).order('data', { ascending: false }).limit(50),
      carregarCustosEquipe(supabase, empresa),
    ])
    // LGPD (20261005180000): custo por apontamento é custo por pessoa — só quem vê salário recebe (fn_pm_timesheet_custos)
    const custosTs = new Map<string, number>()
    if (c.podeVer) {
      const { data: cs } = await supabase.rpc('fn_pm_timesheet_custos', { p_company_id: empresa, p_limite: 500 })
      for (const r of (cs ?? []) as { id: string; custo_total: number | null }[]) custosTs.set(r.id, Number(r.custo_total ?? 0))
    }
    setPodeVerCusto(c.podeVer)
    const lista = (j.data ?? []) as JobOpt[]
    setJobs(lista)
    setJobSel((atual) => atual || jobDoLink(window.location.search, lista))
    const ts = ((t.data ?? []) as Omit<Linha, 'custo_total'>[]).map((l) => ({ ...l, custo_total: custosTs.get(l.id) ?? null }))
    setLinhas(ts)
    // A lista do seletor é cortada em 1000 linhas pelo PostgREST; com milhares de jobs, os jobs usados nos
    // apontamentos podiam ficar de fora e a coluna Job mostrava "—". Busca os títulos exatamente dos jobs
    // referenciados nestes lançamentos para a tabela sempre resolver o nome real (RD-98).
    const idsUsados = Array.from(new Set(ts.map((l) => l.job_id).filter((x): x is string => !!x)))
    const mapa = new Map<string, JobOpt>(lista.map((o) => [o.id, o] as [string, JobOpt]))
    const faltam = idsUsados.filter((id) => !mapa.has(id))
    if (faltam.length) {
      const { data: extra } = await supabase.from('agency_jobs').select('id, titulo, numero').in('id', faltam)
      for (const o of (extra ?? []) as JobOpt[]) mapa.set(o.id, o)
    }
    setJobMap(mapa)
    setMembros(((e.data ?? []) as { id: string; nome: string }[]).map((m) => ({ ...m, custo_hora: c.custos.get(m.id) ?? null })))
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const x = setTimeout(() => setToast(null), 3000); return () => clearTimeout(x) }, [toast])
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  // Ruído de cronômetro: lançamento com menos de ~3 min (0,05 h) — iniciar/parar sem trabalho real.
  const ehRuido = (l: Linha) => Number(l.horas ?? 0) < 0.05
  const ruidoCount = useMemo(() => linhas.filter((l) => Number(l.horas ?? 0) < 0.05).length, [linhas])
  const linhasVis = useMemo(() => (ocultarRuido ? linhas.filter((l) => Number(l.horas ?? 0) >= 0.05) : linhas), [linhas, ocultarRuido])
  // Os totais acompanham o que está à vista: com o ruído oculto, "Horas" e "Custo" refletem só o trabalho real (RD-98).
  const totalHorasMes = useMemo(() => linhasVis.reduce((s, l) => s + Number(l.horas ?? 0), 0), [linhasVis])
  const custoMes = useMemo(() => linhasVis.reduce((s, l) => s + Number(l.custo_total ?? 0), 0), [linhasVis])
  // Horas agrupadas por job nestes lançamentos: a cadeia horas → job → margem fica visível numa olhada (RD-98).
  const porJob = useMemo(() => {
    const m = new Map<string, { titulo: string; numero: string | null; horas: number; custo: number }>()
    for (const l of linhasVis) {
      const key = l.job_id ?? 'sem'
      const job = l.job_id ? jobMap.get(l.job_id) : undefined
      const cur = m.get(key) ?? { titulo: job?.titulo ?? 'Sem job vinculado', numero: job?.numero ?? null, horas: 0, custo: 0 }
      cur.horas += Number(l.horas ?? 0); cur.custo += Number(l.custo_total ?? 0)
      m.set(key, cur)
    }
    return Array.from(m.values()).sort((a, b) => b.horas - a.horas)
  }, [linhasVis, jobMap])

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
    // custo_total é coluna GERADA e custo_hora não é gravável pelo logado (LGPD): o servidor preenche.
    // fim_em setado = entrada concluída (o índice único é só p/ timer aberto: fim_em IS NULL).
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(false); setToast('Sessão expirada, entre de novo.'); return }
    const fim = new Date(); const ini = new Date(fim.getTime() - horas * 3_600_000)
    // o custo/hora da pessoa é resolvido no servidor (fn_pm_timesheet_apontar); quem não vê salário apontou sem ver o valor
    const { data: ap, error } = await supabase.rpc('fn_pm_timesheet_apontar', {
      p_company_id: empresa, p_job_id: jobSel, p_membro_id: membroSel || null, p_data: fim.toISOString().slice(0, 10),
      p_horas: horas, p_descricao: desc || null, p_inicio: ini.toISOString(), p_fim: fim.toISOString(),
    })
    setBusy(false)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setHorasManual(''); setDesc(''); const custoAp = (ap as { custo_total?: number | null } | null)?.custo_total
    setToast(`Apontamento CRIADO · ${horas}h${custoAp ? ` · ${brl(Number(custoAp))}` : ''}`); void carregar()
  }

  // Excluir um lançamento errado (RD-98 p4): soft-delete rastreável no servidor (excluido_em + quem + audit_log).
  async function excluir(l: Linha) {
    if (!empresa || busy) return
    const h = Number(l.horas ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
    if (!window.confirm(`Excluir o lançamento de ${h}h? A exclusão fica registrada (quem e quando).`)) return
    setBusy(true)
    const { error } = await supabase.rpc('fn_pm_timesheet_excluir', { p_company_id: empresa, p_id: l.id })
    setBusy(false)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setToast('Lançamento EXCLUÍDO'); void carregar()
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
            <label style={lbl}><span>Job <AjudaCampo chave="pm.apontamento.job" /></span>
              <select data-testid="apont-job" style={inp} value={jobSel} onChange={(e) => setJobSel(e.target.value)}>
                <option value="">Selecione…</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.titulo}</option>)}
              </select>
            </label>
            <label style={lbl}><span>Responsável <AjudaCampo chave="pm.apontamento.responsavel" /></span>
              <select style={inp} value={membroSel} onChange={(e) => setMembroSel(e.target.value)}>
                <option value="">—</option>
                {membros.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.custo_hora != null ? ` · ${brl(Number(m.custo_hora))}/h` : ''}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }} data-testid="apont-atalhos">
            <span style={{ fontSize: 12, color: TEXTM }}>1 toque <AjudaCampo chave="pm.apontamento.atalho" /></span>
            {ATALHOS_HORAS.map((a) => (
              <button key={a.horas} type="button" disabled={busy || !jobSel || rodando != null} onClick={() => void gravar(a.horas)}
                data-testid={`apont-atalho-${a.horas}`} style={{ ...btnSec, fontWeight: 700, opacity: !jobSel ? 0.5 : 1 }}>{a.rotulo}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <AjudaCampo chave="pm.apontamento.cronometro" />
            {rodando == null
              ? <button onClick={iniciar} style={btnPri}>▶ Iniciar cronômetro</button>
              : <><span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtT(elapsed)}</span><button onClick={parar} style={btnStop}>■ Parar e gravar</button></>}
            <span style={{ color: TEXTM }}>ou</span>
            <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center' }}>
              <input type="number" placeholder="horas" style={{ ...inp, width: 100 }} value={horasManual} onChange={(e) => setHorasManual(e.target.value)} />
              <AjudaCampo chave="pm.apontamento.horas" />
            </label>
            <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 160 }}>
              <input placeholder="descrição" style={{ ...inp, flex: 1, minWidth: 140 }} value={desc} onChange={(e) => setDesc(e.target.value)} />
              <AjudaCampo chave="pm.apontamento.descricao" />
            </label>
            <button disabled={busy} onClick={gravarManual} style={btnSec}>+ Manual</button>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Horas (últimas)" v={totalHorasMes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ajuda="pm.apontamento.kpi_horas" />
          {podeVerCusto && <Kpi l="Custo apontado" v={brl(custoMes)} ajuda="pm.apontamento.kpi_custo" />}
          <Kpi l="Lançamentos" v={String(linhas.length)} sub={ruidoCount > 0 ? `${linhas.length - ruidoCount} reais · ${ruidoCount} de ruído` : undefined} ajuda="pm.apontamento.kpi_lancamentos" />
        </div>

        {!loading && linhasVis.length > 0 && (
          <section data-testid="apont-por-job" style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>Horas por job (nestes lançamentos)</span>
              <AjudaCampo chave="pm.apontamento.job" />
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {porJob.map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                  <span style={{ color: ESPRESSO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.titulo}{g.numero ? <span style={{ color: TEXTM, fontSize: 11 }}> · {g.numero}</span> : null}
                  </span>
                  <span style={{ display: 'flex', gap: 12, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    <b>{g.horas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}h</b>
                    {podeVerCusto && <span style={{ color: GREEN, fontWeight: 600 }}>{brl(g.custo)}</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        {/* Honestidade do dado (RD-98): só horas vinculadas a um job entram na margem do job. */}
        {!loading && linhas.length > 0 && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: TEXTM }}>A cadeia é <b>horas → job → margem</b>: só horas com um job vinculado entram na margem daquele job.</span>
            {ruidoCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button type="button" onClick={() => setOcultarRuido((v) => !v)} data-testid="apont-toggle-ruido"
                  style={{ ...btnSec, fontWeight: 700 }}>
                  {ocultarRuido ? `Mostrar ruído de cronômetro (${ruidoCount})` : `Ocultar ruído de cronômetro (${ruidoCount})`}
                </button>
                <AjudaCampo chave="pm.apontamento.ruido" />
              </span>
            )}
          </div>
        )}
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : linhas.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Inicie o cronômetro no job ou lance manual.</div>
          ) : linhasVis.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>
              Todos os {linhas.length} lançamentos recentes são ruído de cronômetro (menos de 3 min).{' '}
              <button type="button" onClick={() => setOcultarRuido(false)} style={{ ...btnSec, marginLeft: 6 }}>Mostrar mesmo assim</button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th><span style={THWRAP}>Data <AjudaCampo chave="pm.apontamento.col_data" /></span></Th><Th><span style={THWRAP}>Job <AjudaCampo chave="pm.apontamento.col_job" /></span></Th><Th><span style={THWRAP}>Etapa <AjudaCampo chave="pm.apontamento.col_etapa" /></span></Th><Th><span style={THWRAP}>Horas <AjudaCampo chave="pm.apontamento.col_horas" /></span></Th>{podeVerCusto && <Th><span style={THWRAP}>Custo <AjudaCampo chave="pm.apontamento.col_custo" /></span></Th>}<Th><span style={THWRAP}>Descrição <AjudaCampo chave="pm.apontamento.col_descricao" /></span></Th><Th><span style={THWRAP}>Ações <AjudaCampo chave="pm.apontamento.excluir" /></span></Th></tr></thead>
                <tbody>
                  {linhasVis.map((l) => {
                    const job = l.job_id ? jobMap.get(l.job_id) : undefined
                    const ruido = ehRuido(l)
                    return (
                    <tr key={l.id} style={{ borderTop: `1px solid ${BORDA}`, opacity: ruido ? 0.6 : 1 }}>
                      <Td>{l.data}</Td>
                      <Td>{job
                        ? <>{job.titulo}{job.numero ? <span style={{ color: TEXTM, fontSize: 11 }}> · {job.numero}</span> : null}</>
                        : <span style={{ fontSize: 11, fontWeight: 700, color: AMBER, background: AMBERBG, borderRadius: 999, padding: '2px 8px' }}>sem job vinculado</span>}</Td>
                      <Td>{l.etapa_tipo ?? '—'}</Td>
                      <Td>{Number(l.horas).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}h{ruido && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: AMBER, background: AMBERBG, borderRadius: 999, padding: '2px 7px' }}>ruído</span>}</Td>
                      {podeVerCusto && <Td style={{ color: GREEN, fontWeight: 600 }}>{brl(Number(l.custo_total ?? 0))}</Td>}
                      <Td style={{ color: TEXTM }}>{l.descricao ?? ''}</Td>
                      <Td><button type="button" onClick={() => void excluir(l)} disabled={busy} data-testid={`apont-excluir-${l.id}`} title="Excluir lançamento" style={btnDel}>Excluir</button></Td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Kpi({ l, v, sub, ajuda }: { l: string; v: string; sub?: string; ajuda?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700, display: 'flex', alignItems: 'center' }}>{l}{ajuda && <AjudaCampo chave={ajuda} />}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: ESPRESSO, marginTop: 2 }}>{v}</div>
    {sub && <div style={{ fontSize: 11, color: TEXTM, marginTop: 2 }}>{sub}</div>}
  </div>
}
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: TEXTM }}>{children}</th> }
function Td({ children, style }: { children?: React.ReactNode; style?: CSSProperties }) { return <td style={{ padding: '8px 12px', color: ESPRESSO, ...style }}>{children}</td> }
const inp: CSSProperties = { border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40, background: '#fff', color: ESPRESSO }
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: TEXTM }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnStop: CSSProperties = { border: 'none', background: '#7A1F1F', color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer', minHeight: 40 }
const btnDel: CSSProperties = { border: `1px solid ${BORDA}`, color: '#7A1F1F', background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
// "?" (RD-95) nas colunas da tabela: rótulo + AjudaCampo lado a lado no cabeçalho.
const THWRAP: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 }
