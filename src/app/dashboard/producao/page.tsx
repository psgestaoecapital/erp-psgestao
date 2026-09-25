'use client'
import React, { Suspense, useState, useEffect, useRef, type CSSProperties, type DragEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { labelUsuario } from '@/lib/usuarioLabel'

// Identidade Espresso (mesmos tokens do CRM Oportunidades / Financiamentos)
const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DED3'
const TEXTM    = '#6b5444'
const TEXTD    = '#9a8e80'
const GREEN    = '#1F5A1F'
const YELLOW   = '#7A5A0F'
const RED      = '#7A1F1F'

const brl = (v: number) => v === 0 || v == null
  ? '—'
  : (v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Cliente = {
  id: string; nome: string; nome_fantasia: string; cnpj_cpf: string
  email: string; telefone: string; contato_principal: string; segmento: string
  fee_mensal: number; tipo_contrato: string; status: string; observacoes: string
  contrato_id: string | null
}
type Job = {
  id: string; numero: string; titulo: string; tipo: string; status: string
  prioridade: string; cliente_id: string; responsavel_id: string; responsavel_nome: string | null
  data_inicio: string | null; data_prazo: string; valor_job: number; horas_estimadas: number; horas_realizadas: number
  percentual_comissao: number | null; descricao: string | null; created_at: string
}

// Preview seguro do briefing no card: tira qualquer tag HTML (defensivo p/ dados antigos),
// normaliza espaços e trunca. NUNCA renderiza HTML — o briefing é texto/markdown puro.
function previewBriefing(s: string | null | undefined, max = 90): string {
  if (!s) return ''
  const limpo = s.replace(/<[^>]*>/g, ' ').replace(/[*_#>`-]/g, ' ').replace(/\s+/g, ' ').trim()
  return limpo.length > max ? limpo.slice(0, max) + '…' : limpo
}
type Timesheet = {
  id: string; job_id: string; user_id: string; data: string
  horas: number; descricao: string; tipo_atividade: string
}
type ContratoOpt = { id: string; numero: string | null; nome: string | null; valor_mensal: number | null; status: string | null }
type ServicoOpt = { id: string; nome: string; area: string | null; valor_base: number | null; horas_estimadas: number | null; responsavel_padrao_id: string | null }
type Tarefa = {
  id: string; job_id: string; titulo: string; descricao: string | null
  responsavel_id: string | null; status: string; prioridade: string; ordem: number
  data_prazo: string | null; data_conclusao: string | null
  horas_estimadas: number | null; horas_realizadas: number | null
}

// Status das ETAPAS do job (agency_tarefas). Sem trava — a equipe começa a usar agora.
const ETAPA_STATUS: { v: string; l: string; bg: string; fg: string }[] = [
  { v: 'pendente',     l: 'A fazer',     bg: '#F0E9DE', fg: TEXTM },
  { v: 'em_andamento', l: 'Fazendo',     bg: '#FFF3D6', fg: YELLOW },
  { v: 'concluida',    l: 'Concluída',   bg: '#DCEFD7', fg: GREEN },
]
const etapaStatusCfg = (v: string) => ETAPA_STATUS.find((e) => e.v === v) ?? { v, l: v, bg: OFFWHITE, fg: ESPRESSO }

// 5 estagios oficiais (spec). Ordem: esquerda -> direita.
const ESTAGIOS: { v: string; l: string; bg: string; fg: string }[] = [
  { v: 'nao_iniciada',  l: 'Não iniciada',  bg: '#F0E9DE', fg: TEXTM },
  { v: 'em_producao',   l: 'Em produção',   bg: '#FFF3D6', fg: YELLOW },
  { v: 'em_aprovacao',  l: 'Em aprovação',  bg: '#FCE9C2', fg: YELLOW },
  { v: 'concluida',     l: 'Concluída',     bg: '#DCEFD7', fg: GREEN },
  { v: 'publicado',     l: 'Publicado',     bg: '#E7DED3', fg: ESPRESSO },
]
const estagioCfg = (v: string) => ESTAGIOS.find((e) => e.v === v) ?? { v, l: v, bg: OFFWHITE, fg: ESPRESSO }

const PRIORIDADES: Record<string, { l: string; cor: string }> = {
  baixa:   { l: 'Baixa',   cor: TEXTD },
  normal:  { l: 'Normal',  cor: TEXTM },
  alta:    { l: 'Alta',    cor: YELLOW },
  urgente: { l: 'Urgente', cor: RED },
}

function ProducaoPageInner() {
  const searchParams = useSearchParams()
  const empresaParam = searchParams.get('empresa')

  const [companies, setCompanies] = useState<Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }>>([])
  const [sel, setSel] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'clientes' | 'jobs' | 'kanban' | 'timesheet'>('kanban')

  const [clientes, setClientes] = useState<Cliente[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [contratos, setContratos] = useState<ContratoOpt[]>([])
  const [servicos, setServicos] = useState<ServicoOpt[]>([])   // catálogo p/ irrigar o job (horas/responsável/valor)
  const [responsaveis, setResponsaveis] = useState<Array<{ id: string; email: string | null; full_name?: string | null }>>([])

  const [showForm, setShowForm] = useState<'cliente' | 'job' | 'timesheet' | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [movendoId, setMovendoId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [hoverCol, setHoverCol] = useState<string | null>(null)

  const [metrics, setMetrics] = useState({ clientes: 0, jobs_ativos: 0, horas_mes: 0, receita_mes: 0 })

  // Etapas do job (agency_tarefas)
  const [jobEtapas, setJobEtapas] = useState<Job | null>(null)
  const [etapas, setEtapas] = useState<Tarefa[]>([])
  const [etapasLoading, setEtapasLoading] = useState(false)
  const [novaEtapa, setNovaEtapa] = useState<{ titulo: string; responsavel_id: string; data_prazo: string; horas_estimadas: string }>({ titulo: '', responsavel_id: '', data_prazo: '', horas_estimadas: '' })
  const [etapaBusy, setEtapaBusy] = useState<string | null>(null)
  const [maisDetalhesJob, setMaisDetalhesJob] = useState(false)

  useEffect(() => { void loadCompanies() }, [])
  useEffect(() => { if (sel) void loadAll() }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  async function loadCompanies() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: up } = await supabase.from('users').select('role').eq('id', user.id).single()
    let d: Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }> = []
    if (up?.role === 'adm' || up?.role === 'acesso_total') {
      const r = await supabase.from('companies').select('id,nome_fantasia,razao_social').order('nome_fantasia')
      d = r.data ?? []
    } else {
      const r = await supabase.from('user_companies').select('companies(id,nome_fantasia,razao_social)').eq('user_id', user.id)
      d = ((r.data ?? []) as unknown as Array<{ companies: { id: string; nome_fantasia: string | null; razao_social: string | null } | null }>)
        .map((u) => u.companies).filter(Boolean) as typeof d
    }
    setCompanies(d)
    const s = empresaParam || (typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : '') || ''
    const m = s ? d.find((c) => c.id === s) : null
    setSel(m ? m.id : (d[0]?.id ?? ''))
    setLoading(false)
  }

  async function loadAll() {
    const [cl, jb, ts, us, ct, sv] = await Promise.all([
      supabase.from('agency_clientes').select('*').eq('company_id', sel).order('nome'),
      supabase.from('agency_jobs').select('*').eq('company_id', sel).order('created_at', { ascending: false }),
      supabase.from('agency_timesheet').select('*').eq('company_id', sel).order('data', { ascending: false }),
      supabase.rpc('fn_usuarios_da_empresa', { p_company_id: sel }),
      supabase.from('erp_contratos').select('id,numero,nome,valor_mensal,status').eq('company_id', sel).order('numero', { ascending: false }),
      supabase.rpc('fn_agency_servico_listar_proposta', { p_company_id: sel }),
    ])
    setClientes((cl.data ?? []) as Cliente[])
    setJobs((jb.data ?? []) as Job[])
    setTimesheets((ts.data ?? []) as Timesheet[])
    type U = { id: string; email: string | null; full_name?: string | null }
    setResponsaveis((us.data ?? []) as U[])
    setContratos((ct.data ?? []) as ContratoOpt[])
    setServicos(((sv.data as { servicos?: ServicoOpt[] } | null)?.servicos ?? []) as ServicoOpt[])

    const now = new Date()
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    setMetrics({
      clientes: (cl.data ?? []).filter((c: { status?: string }) => c.status === 'ativo').length,
      jobs_ativos: (jb.data ?? []).filter((j: { status?: string }) => !['concluida', 'publicado', 'cancelado'].includes(j.status ?? '')).length,
      horas_mes: (ts.data ?? []).filter((t: { data?: string }) => t.data?.startsWith(mesAtual)).reduce((s: number, t: { horas?: number }) => s + (t.horas ?? 0), 0),
      receita_mes: (cl.data ?? []).filter((c: { status?: string }) => c.status === 'ativo').reduce((s: number, c: { fee_mensal?: number }) => s + (c.fee_mensal ?? 0), 0),
    })
  }

  async function saveCliente() {
    const data = { ...form, company_id: sel }
    const res = editId
      ? await supabase.from('agency_clientes').update(data).eq('id', editId)
      : await supabase.from('agency_clientes').insert(data)
    if (res.error) { setToast(`Erro: ${res.error.message}`); return }
    setToast(editId ? 'Cliente ALTERADO.' : 'Cliente CRIADO.')
    setShowForm(null); setEditId(null); setForm({}); loadAll()
  }
  async function saveJob() {
    const data = { ...form, company_id: sel }
    const res = editId
      ? await supabase.from('agency_jobs').update(data).eq('id', editId)
      : await supabase.from('agency_jobs').insert(data)
    if (res.error) { setToast(`Erro: ${res.error.message}`); return }
    setToast(editId ? 'Job ALTERADO.' : 'Job CRIADO.')
    setShowForm(null); setEditId(null); setForm({}); loadAll()
  }
  async function saveTimesheet() {
    const { data: { user } } = await supabase.auth.getUser()
    const data = { ...form, company_id: sel, user_id: user?.id }
    const res = await supabase.from('agency_timesheet').insert(data)
    if (res.error) { setToast(`Erro: ${res.error.message}`); return }
    setToast('Horas REGISTRADAS.')
    setShowForm(null); setForm({}); loadAll()
  }
  async function excluir(table: string, id: string) {
    if (!confirm('EXCLUIR este registro?')) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setToast('Registro EXCLUIDO.')
    loadAll()
  }

  // ─── Etapas do job (agency_tarefas) ────────────────────────
  async function abrirEtapas(job: Job) {
    setJobEtapas(job)
    setNovaEtapa({ titulo: '', responsavel_id: '', data_prazo: '', horas_estimadas: '' })
    await carregarEtapas(job.id)
  }
  async function carregarEtapas(jobId: string) {
    setEtapasLoading(true)
    const { data } = await supabase
      .from('agency_tarefas')
      .select('id, job_id, titulo, descricao, responsavel_id, status, prioridade, ordem, data_prazo, data_conclusao, horas_estimadas, horas_realizadas')
      .eq('company_id', sel).eq('job_id', jobId)
      .order('ordem', { ascending: true }).order('created_at', { ascending: true })
    setEtapas((data ?? []) as Tarefa[])
    setEtapasLoading(false)
  }
  async function addEtapa() {
    if (!jobEtapas || !novaEtapa.titulo.trim()) { setToast('Dê um título à etapa.'); return }
    const proxOrdem = etapas.length ? Math.max(...etapas.map((e) => e.ordem ?? 0)) + 1 : 0
    setEtapaBusy('nova')
    const { error } = await supabase.from('agency_tarefas').insert({
      company_id: sel, job_id: jobEtapas.id, titulo: novaEtapa.titulo.trim(),
      responsavel_id: novaEtapa.responsavel_id || null,
      data_prazo: novaEtapa.data_prazo || null,
      horas_estimadas: novaEtapa.horas_estimadas ? parseFloat(novaEtapa.horas_estimadas) : 0,
      ordem: proxOrdem, status: 'pendente',
    })
    setEtapaBusy(null)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setNovaEtapa({ titulo: '', responsavel_id: '', data_prazo: '', horas_estimadas: '' })
    await carregarEtapas(jobEtapas.id)
  }
  async function mudarStatusEtapa(t: Tarefa, novo: string) {
    if (!jobEtapas) return
    setEtapaBusy(t.id)
    const patch: Record<string, unknown> = { status: novo, updated_at: new Date().toISOString() }
    patch.data_conclusao = novo === 'concluida' ? new Date().toISOString().slice(0, 10) : null
    const { error } = await supabase.from('agency_tarefas').update(patch).eq('id', t.id)
    if (error) { setEtapaBusy(null); setToast(`Erro: ${error.message}`); return }
    const atualizadas = etapas.map((e) => e.id === t.id ? { ...e, status: novo } : e)
    setEtapas(atualizadas)
    // Concluir a ÚLTIMA etapa move o job (todas concluídas → avança um estágio).
    if (novo === 'concluida' && atualizadas.length > 0 && atualizadas.every((e) => e.status === 'concluida')) {
      const idx = ESTAGIOS.findIndex((s) => s.v === jobEtapas.status)
      const prox = idx >= 0 && idx < ESTAGIOS.length - 1 ? ESTAGIOS[idx + 1].v : null
      if (prox) {
        const { error: e2 } = await supabase.rpc('fn_pm_job_mover_status', { p_job_id: jobEtapas.id, p_status: prox })
        if (!e2) {
          setJobEtapas({ ...jobEtapas, status: prox })
          setToast(`Todas as etapas concluídas — job movido para ${estagioCfg(prox).l}.`)
          void loadAll()
        } else { setToast('Etapa concluída.') }
      } else { setToast('Etapa concluída — job já no último estágio.') }
    } else {
      setToast(novo === 'concluida' ? 'Etapa concluída.' : 'Etapa atualizada.')
    }
    setEtapaBusy(null)
  }
  async function moverEtapaOrdem(t: Tarefa, dir: -1 | 1) {
    if (!jobEtapas) return
    const idx = etapas.findIndex((e) => e.id === t.id)
    const alvo = idx + dir
    if (alvo < 0 || alvo >= etapas.length) return
    const outra = etapas[alvo]
    setEtapaBusy(t.id)
    await Promise.all([
      supabase.from('agency_tarefas').update({ ordem: outra.ordem }).eq('id', t.id),
      supabase.from('agency_tarefas').update({ ordem: t.ordem }).eq('id', outra.id),
    ])
    setEtapaBusy(null)
    await carregarEtapas(jobEtapas.id)
  }
  async function excluirEtapa(t: Tarefa) {
    if (!jobEtapas) return
    if (!confirm('Excluir esta etapa?')) return
    const { error } = await supabase.from('agency_tarefas').delete().eq('id', t.id)
    if (error) { setToast(`Erro: ${error.message}`); return }
    await carregarEtapas(jobEtapas.id)
  }

  // ─── Kanban: drag-and-drop + move ──────────────────────────
  async function moverEstagio(jobId: string, novo: string, atual: string | null) {
    if (atual === novo) return
    setMovendoId(jobId)
    // otimista
    setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: novo } : j))
    const { data, error } = await supabase.rpc('fn_pm_job_mover_status', { p_job_id: jobId, p_status: novo })
    setMovendoId(null)
    if (error) { setToast(`Erro ao mover: ${error.message}`); loadAll(); return }
    const r = data as { ok?: boolean; erro?: string } | null
    if (r && r.ok === false) { setToast(`Erro: ${r.erro ?? 'falha'}`); loadAll(); return }
    setToast(`Job movido para ${estagioCfg(novo).l}.`)
    loadAll()
  }
  function onDragStart(e: DragEvent<HTMLDivElement>, jobId: string) {
    e.dataTransfer.setData('text/plain', jobId)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(jobId)
  }
  function onDragOver(e: DragEvent<HTMLDivElement>, etapa: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (hoverCol !== etapa) setHoverCol(etapa)
  }
  function onDrop(e: DragEvent<HTMLDivElement>, etapa: string) {
    e.preventDefault()
    const jobId = e.dataTransfer.getData('text/plain') || dragId
    setDragId(null); setHoverCol(null)
    if (!jobId) return
    const atual = jobs.find((j) => j.id === jobId)?.status ?? null
    moverEstagio(jobId, etapa, atual)
  }

  if (loading) return (
    <div className="min-h-screen p-6" style={{ background: OFFWHITE, color: TEXTM }}>Carregando…</div>
  )

  return (
    <div className="min-h-screen p-4" style={{ background: OFFWHITE, color: ESPRESSO }}>
      {/* HEADER */}
      <header className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-bold">🎨 Workspace · Produção & Marketing</h1>
          <p className="text-sm" style={{ color: TEXTM }}>Clientes, jobs, kanban e timesheet da agência.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sel}
            onChange={(e) => {
              setSel(e.target.value)
              if (typeof window !== 'undefined') localStorage.setItem('ps_empresa_sel', e.target.value)
            }}
            style={selEmp}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>
            ))}
          </select>
          <a href="/dashboard" style={btnLink}>← Dashboard</a>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Kpi titulo="Clientes ativos" valor={String(metrics.clientes)} />
        <Kpi titulo="Jobs em andamento" valor={String(metrics.jobs_ativos)} />
        <Kpi titulo="Horas no mês" valor={`${metrics.horas_mes.toFixed(1)}h`} />
        <Kpi titulo="Receita recorrente (fees)" valor={brl(metrics.receita_mes)} destaque />
      </div>

      {/* TABS */}
      <nav style={tabBar}>
        {(['kanban', 'jobs', 'clientes', 'timesheet'] as const).map((id) => (
          <button key={id} onClick={() => setTab(id)} style={tabBtn(tab === id)}>
            {id === 'kanban' ? 'Kanban' : id === 'jobs' ? 'Jobs (lista)' : id === 'clientes' ? 'Clientes' : 'Timesheet'}
          </button>
        ))}
      </nav>

      {/* ─── TAB: KANBAN ─── */}
      {tab === 'kanban' && (
        <KanbanBoard
          jobs={jobs}
          clientes={clientes}
          dragId={dragId}
          hoverCol={hoverCol}
          movendoId={movendoId}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={(c) => { if (hoverCol === c) setHoverCol(null) }}
          onDrop={onDrop}
          onMover={moverEstagio}
          onEtapas={abrirEtapas}
          onAdd={() => { setForm({ status: 'nao_iniciada', prioridade: 'normal' }); setEditId(null); setShowForm('job') }}
        />
      )}

      {/* ─── TAB: JOBS (lista) ─── */}
      {tab === 'jobs' && (
        <JobsTabela
          jobs={jobs}
          clientes={clientes}
          responsaveis={responsaveis}
          onNovo={() => { setForm({ status: 'nao_iniciada', prioridade: 'normal' }); setEditId(null); setShowForm('job') }}
          onEditar={(j) => {
            setForm({
              titulo: j.titulo, tipo: j.tipo, status: j.status, prioridade: j.prioridade,
              cliente_id: j.cliente_id, responsavel_id: j.responsavel_id, responsavel_nome: j.responsavel_nome,
              data_inicio: j.data_inicio, data_prazo: j.data_prazo, valor_job: j.valor_job,
              horas_estimadas: j.horas_estimadas, percentual_comissao: j.percentual_comissao,
              descricao: j.descricao,
            })
            setMaisDetalhesJob(false); setEditId(j.id); setShowForm('job')
          }}
          onEtapas={abrirEtapas}
          onExcluir={(j) => excluir('agency_jobs', j.id)}
        />
      )}

      {/* ─── TAB: CLIENTES ─── */}
      {tab === 'clientes' && (
        <ClientesTabela
          clientes={clientes}
          contratos={contratos}
          onNovo={() => { setForm({ status: 'ativo', tipo_contrato: 'fee_mensal' }); setEditId(null); setShowForm('cliente') }}
          onEditar={(c) => {
            setForm({
              nome: c.nome, nome_fantasia: c.nome_fantasia, cnpj_cpf: c.cnpj_cpf,
              email: c.email, telefone: c.telefone, contato_principal: c.contato_principal,
              segmento: c.segmento, fee_mensal: c.fee_mensal, tipo_contrato: c.tipo_contrato,
              status: c.status, observacoes: c.observacoes, contrato_id: c.contrato_id,
            })
            setEditId(c.id); setShowForm('cliente')
          }}
          onExcluir={(c) => excluir('agency_clientes', c.id)}
        />
      )}

      {/* ─── TAB: TIMESHEET ─── */}
      {tab === 'timesheet' && (
        <TimesheetTabela
          timesheets={timesheets}
          jobs={jobs}
          onNovo={() => { setForm({ data: new Date().toISOString().slice(0, 10) }); setShowForm('timesheet') }}
          onExcluir={(t) => excluir('agency_timesheet', t.id)}
        />
      )}

      {/* ─── FORM modal: cliente ─── */}
      {showForm === 'cliente' && (
        <Modal titulo={editId ? 'Editar cliente' : 'Novo cliente'} onClose={() => { setShowForm(null); setEditId(null); setForm({}) }}>
          <div style={grid2}>
            <Field label="Razão Social *" v={form.nome} on={(v) => setForm({ ...form, nome: v })} />
            <Field label="Nome Fantasia" v={form.nome_fantasia} on={(v) => setForm({ ...form, nome_fantasia: v })} />
            <Field label="CNPJ/CPF" v={form.cnpj_cpf} on={(v) => setForm({ ...form, cnpj_cpf: v })} />
            <Field label="E-mail" v={form.email} on={(v) => setForm({ ...form, email: v })} />
            <Field label="Telefone" v={form.telefone} on={(v) => setForm({ ...form, telefone: v })} />
            <Field label="Contato principal" v={form.contato_principal} on={(v) => setForm({ ...form, contato_principal: v })} />
            <Field label="Segmento" v={form.segmento} on={(v) => setForm({ ...form, segmento: v })} />
            <Field label="Fee mensal (R$)" type="number" v={form.fee_mensal} on={(v) => setForm({ ...form, fee_mensal: parseFloat(v) || 0 })} />
            <Select label="Tipo de contrato" v={(form.tipo_contrato as string) ?? 'fee_mensal'} on={(v) => setForm({ ...form, tipo_contrato: v })}
              opts={[['fee_mensal', 'Fee mensal'], ['projeto', 'Projeto'], ['avulso', 'Avulso']]} />
            <Select label="Status" v={(form.status as string) ?? 'ativo'} on={(v) => setForm({ ...form, status: v })}
              opts={[['ativo', 'Ativo'], ['inativo', 'Inativo'], ['prospect', 'Prospect']]} />
            <Select label="Contrato GE vinculado" v={(form.contrato_id as string) ?? ''} on={(v) => setForm({ ...form, contrato_id: v || null })}
              opts={[['', '— nenhum —'], ...contratos.map((c) => [c.id, `${c.numero ?? c.id.slice(0, 8)}${c.nome ? ' · ' + c.nome : ''}${c.valor_mensal ? ' · ' + brl(c.valor_mensal) : ''}`] as [string, string])]} />
          </div>
          <Field label="Observações" v={form.observacoes} on={(v) => setForm({ ...form, observacoes: v })} multiline />
          {form.contrato_id ? (
            <p style={hintBox}>
              💡 Este cliente está vinculado a um contrato recorrente da Gestão Empresarial. As cobranças são geradas pelo motor da GE — a P&M não duplica financeiro.
            </p>
          ) : null}
          <div style={actions}>
            <button onClick={() => { setShowForm(null); setEditId(null); setForm({}) }} style={btnGhost}>Cancelar</button>
            <button onClick={saveCliente} style={btnPrimary}>{editId ? 'SALVAR' : 'CRIAR'}</button>
          </div>
        </Modal>
      )}

      {/* ─── FORM modal: job ─── */}
      {showForm === 'job' && (
        <Modal titulo={editId ? 'Editar job' : 'Novo job'} onClose={() => { setShowForm(null); setEditId(null); setForm({}); setMaisDetalhesJob(false) }}>
          {/* ESSENCIAL */}
          <div style={grid2}>
            <Field label="Título *" v={form.titulo} on={(v) => setForm({ ...form, titulo: v })} />
            <Select label="Cliente" v={(form.cliente_id as string) ?? ''} on={(v) => setForm({ ...form, cliente_id: v || null })}
              opts={[['', '— selecionar —'], ...clientes.map((c) => [c.id, c.nome_fantasia || c.nome] as [string, string])]} />
            {servicos.length > 0 && (
              <Select label="Serviço (catálogo)" v={(form.servico_id as string) ?? ''}
                on={(v) => {
                  const s = servicos.find((x) => x.id === v)
                  if (!s) { setForm({ ...form, servico_id: null }); return }
                  setForm({
                    ...form, servico_id: s.id,
                    titulo: form.titulo || s.nome,
                    valor_job: form.valor_job || s.valor_base || 0,
                    horas_estimadas: form.horas_estimadas || s.horas_estimadas || 0,
                    responsavel_id: (form.responsavel_id as string) || s.responsavel_padrao_id || null,
                  })
                }}
                opts={[['', '— do catálogo (herda horas/responsável) —'], ...servicos.map((s) => [s.id, s.nome] as [string, string])]} />
            )}
            <Select label="Estágio" v={(form.status as string) ?? 'nao_iniciada'} on={(v) => setForm({ ...form, status: v })}
              opts={ESTAGIOS.map((e) => [e.v, e.l])} />
            <Select label="Prioridade" v={(form.prioridade as string) ?? 'normal'} on={(v) => setForm({ ...form, prioridade: v })}
              opts={Object.entries(PRIORIDADES).map(([k, p]) => [k, p.l])} />
          </div>

          {/* BRIEFING — em destaque, o campo mais usado */}
          <BriefingEditor value={(form.descricao as string) ?? ''} onChange={(v) => setForm({ ...form, descricao: v })} />

          {/* PRAZOS & RESPONSÁVEL */}
          <div style={{ fontSize: 12, fontWeight: 700, color: ESPRESSO, margin: '14px 0 6px' }}>Prazos & responsável</div>
          <div style={grid2}>
            <Field label="Início" type="date" v={form.data_inicio} on={(v) => setForm({ ...form, data_inicio: v || null })} />
            <Field label="Prazo" type="date" v={form.data_prazo} on={(v) => setForm({ ...form, data_prazo: v })} />
            <Select label="Responsável" v={(form.responsavel_id as string) ?? ''} on={(v) => setForm({ ...form, responsavel_id: v || null, responsavel_nome: v ? null : (form.responsavel_nome ?? null) })}
              opts={[['', '—'], ...responsaveis.map((u) => [u.id, labelUsuario(u, responsaveis)] as [string, string])]} />
            <Field label="Responsável (sem login)" v={form.responsavel_nome as string | undefined}
              on={(v) => setForm({ ...form, responsavel_nome: v || null, responsavel_id: v ? null : (form.responsavel_id ?? null) })} />
          </div>

          {/* MAIS DETALHES — colapsado */}
          <button type="button" onClick={() => setMaisDetalhesJob(!maisDetalhesJob)} style={maisDetalhesBtn}>
            {maisDetalhesJob ? '▾' : '▸'} Mais detalhes
          </button>
          {maisDetalhesJob && (
            <div style={grid2}>
              <Select label="Tipo" v={(form.tipo as string) ?? ''} on={(v) => setForm({ ...form, tipo: v || null })}
                opts={[['', '— tipo —'], ['site', 'Site'], ['video', 'Vídeo'], ['arte', 'Arte/Design'],
                  ['campanha', 'Campanha'], ['social_media', 'Social Media'], ['assessoria', 'Assessoria'],
                  ['logomarca', 'Logomarca'], ['catalogo', 'Catálogo'], ['lp', 'Landing Page']]} />
              <Field label="Valor (R$)" type="number" v={form.valor_job} on={(v) => setForm({ ...form, valor_job: parseFloat(v) || 0 })} />
              <Field label="Horas estimadas" type="number" v={form.horas_estimadas} on={(v) => setForm({ ...form, horas_estimadas: parseFloat(v) || 0 })} />
              <Field label="% Comissão (preview)" type="number" v={form.percentual_comissao} on={(v) => setForm({ ...form, percentual_comissao: v === '' ? null : parseFloat(v) })} />
            </div>
          )}
          {(form.valor_job && form.percentual_comissao) ? (
            <p style={hintBox}>
              💰 Comissão calculada (preview): <b>{brl(Number(form.valor_job) * Number(form.percentual_comissao) / 100)}</b>.
              Quando o job for marcado como <b>publicado</b>, a comissão será lançada em <b>Contas a Pagar</b> da GE (em PR futuro — sem gravação automática nesta versão).
            </p>
          ) : null}
          <div style={actions}>
            <button onClick={() => { setShowForm(null); setEditId(null); setForm({}); setMaisDetalhesJob(false) }} style={btnGhost}>Cancelar</button>
            <button onClick={saveJob} style={btnPrimary}>{editId ? 'SALVAR' : 'CRIAR'}</button>
          </div>
        </Modal>
      )}

      {/* ─── FORM modal: timesheet ─── */}
      {showForm === 'timesheet' && (
        <Modal titulo="Registrar horas" onClose={() => { setShowForm(null); setForm({}) }}>
          <div style={grid2}>
            <Select label="Job *" v={(form.job_id as string) ?? ''} on={(v) => setForm({ ...form, job_id: v || null })}
              opts={[['', '— selecionar —'], ...jobs
                .filter((j) => !['concluida', 'publicado', 'cancelado'].includes(j.status))
                .map((j) => [j.id, j.titulo] as [string, string])]} />
            <Field label="Data *" type="date" v={form.data} on={(v) => setForm({ ...form, data: v })} />
            <Field label="Horas *" type="number" v={form.horas} on={(v) => setForm({ ...form, horas: parseFloat(v) || 0 })} />
            <Select label="Atividade" v={(form.tipo_atividade as string) ?? ''} on={(v) => setForm({ ...form, tipo_atividade: v || null })}
              opts={[['', '— tipo —'], ['criacao', 'Criação'], ['atendimento', 'Atendimento'],
                ['producao', 'Produção'], ['edicao', 'Edição'], ['revisao', 'Revisão'],
                ['reuniao', 'Reunião'], ['planejamento', 'Planejamento']]} />
          </div>
          <Field label="Descrição" v={form.descricao} on={(v) => setForm({ ...form, descricao: v })} />
          <div style={actions}>
            <button onClick={() => { setShowForm(null); setForm({}) }} style={btnGhost}>Cancelar</button>
            <button onClick={saveTimesheet} style={btnPrimary}>REGISTRAR</button>
          </div>
        </Modal>
      )}

      {/* ─── Painel: ETAPAS do job ─── */}
      {jobEtapas && (
        <Modal titulo={`Etapas · ${jobEtapas.titulo}`} onClose={() => { setJobEtapas(null); setEtapas([]) }}>
          <div style={{ marginBottom: 8, fontSize: 12, color: TEXTM }}>
            Estágio do job: <span style={{ ...etapaChip, background: estagioCfg(jobEtapas.status).bg, color: estagioCfg(jobEtapas.status).fg }}>{estagioCfg(jobEtapas.status).l}</span>
            {etapas.length > 0 && <span style={{ marginLeft: 8 }}>· {etapas.filter((e) => e.status === 'concluida').length}/{etapas.length} concluídas</span>}
          </div>

          {etapasLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: TEXTM }}>Carregando etapas…</div>
          ) : etapas.length === 0 ? (
            <div style={{ ...hintBox, textAlign: 'center' }}>Nenhuma etapa ainda. Adicione a primeira abaixo.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {etapas.map((t, i) => {
                const cfg = etapaStatusCfg(t.status)
                const resp = responsaveis.find((u) => u.id === t.responsavel_id)
                const prazoDias = t.data_prazo ? Math.ceil((new Date(t.data_prazo).getTime() - Date.now()) / 86400000) : null
                const busy = etapaBusy === t.id
                return (
                  <div key={t.id} style={etapaRow}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button onClick={() => moverEtapaOrdem(t, -1)} disabled={i === 0 || busy} style={{ ...ordBtn, opacity: i === 0 ? 0.3 : 1 }} aria-label="Subir">▲</button>
                      <button onClick={() => moverEtapaOrdem(t, 1)} disabled={i === etapas.length - 1 || busy} style={{ ...ordBtn, opacity: i === etapas.length - 1 ? 0.3 : 1 }} aria-label="Descer">▼</button>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: ESPRESSO, fontSize: 14, textDecoration: t.status === 'concluida' ? 'line-through' : 'none' }}>{i + 1}. {t.titulo}</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 3, fontSize: 12, color: TEXTM }}>
                        <span>{resp ? labelUsuario(resp, responsaveis) : '— sem responsável'}</span>
                        {t.data_prazo && <span style={{ color: prazoDias !== null && prazoDias < 0 && t.status !== 'concluida' ? RED : prazoDias !== null && prazoDias <= 3 && t.status !== 'concluida' ? YELLOW : TEXTM }}>
                          {t.status === 'concluida' ? `prazo ${t.data_prazo}` : prazoDias! < 0 ? `${Math.abs(prazoDias!)}d atrasada` : prazoDias === 0 ? 'vence hoje' : `${prazoDias}d`}
                        </span>}
                        {(t.horas_estimadas ?? 0) > 0 && <span>{t.horas_estimadas}h est.</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      <select value={t.status} onChange={(e) => mudarStatusEtapa(t, e.target.value)} disabled={busy}
                        aria-label="Status da etapa" style={{ ...moverSel, width: 120, background: cfg.bg, color: cfg.fg, fontWeight: 600 }}>
                        {ETAPA_STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                      </select>
                      <button onClick={() => excluirEtapa(t)} disabled={busy} style={{ ...btnDanger, minHeight: 28, padding: '2px 8px' }}>excluir</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Adicionar etapa */}
          <div style={{ marginTop: 14, borderTop: `1px solid ${BORDA}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: ESPRESSO, marginBottom: 6 }}>+ Adicionar etapa</div>
            <div style={grid2}>
              <Field label="Título da etapa *" v={novaEtapa.titulo} on={(v) => setNovaEtapa({ ...novaEtapa, titulo: v })} />
              <Select label="Responsável" v={novaEtapa.responsavel_id} on={(v) => setNovaEtapa({ ...novaEtapa, responsavel_id: v })}
                opts={[['', '—'], ...responsaveis.map((u) => [u.id, labelUsuario(u, responsaveis)] as [string, string])]} />
              <Field label="Prazo" type="date" v={novaEtapa.data_prazo} on={(v) => setNovaEtapa({ ...novaEtapa, data_prazo: v })} />
              <Field label="Horas estimadas" type="number" v={novaEtapa.horas_estimadas} on={(v) => setNovaEtapa({ ...novaEtapa, horas_estimadas: v })} />
            </div>
            <div style={actions}>
              <button onClick={addEtapa} disabled={etapaBusy === 'nova'} style={btnPrimary}>{etapaBusy === 'nova' ? 'Adicionando…' : 'Adicionar etapa'}</button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function KanbanBoard({
  jobs, clientes, dragId, hoverCol, movendoId,
  onDragStart, onDragOver, onDragLeave, onDrop, onMover, onEtapas, onAdd,
}: {
  jobs: Job[]; clientes: Cliente[]; dragId: string | null; hoverCol: string | null; movendoId: string | null
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void
  onDragOver: (e: DragEvent<HTMLDivElement>, etapa: string) => void
  onDragLeave: (etapa: string) => void
  onDrop: (e: DragEvent<HTMLDivElement>, etapa: string) => void
  onMover: (id: string, novo: string, atual: string | null) => void
  onEtapas: (job: Job) => void
  onAdd: () => void
}) {
  const cliNome = (id: string) => {
    const c = clientes.find((x) => x.id === id)
    return c?.nome_fantasia || c?.nome || null
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <span className="text-sm" style={{ color: TEXTM }}>Arraste o card entre colunas pra mudar o estágio.</span>
        <button onClick={onAdd} style={btnPrimary}>+ Novo job</button>
      </div>
      <div style={boardWrap}>
        <div style={board}>
          {ESTAGIOS.map((et) => {
            const cards = jobs.filter((j) => j.status === et.v)
            const valor = cards.reduce((s, j) => s + (j.valor_job ?? 0), 0)
            const hover = hoverCol === et.v
            return (
              <div
                key={et.v}
                style={{ ...col, ...(hover ? colHover : {}) }}
                onDragOver={(e) => onDragOver(e, et.v)}
                onDragLeave={() => onDragLeave(et.v)}
                onDrop={(e) => onDrop(e, et.v)}
              >
                <div style={colHead}>
                  <span style={{ ...etapaChip, background: et.bg, color: et.fg }}>{et.l}</span>
                  <span style={{ fontSize: 11, color: TEXTM }}>{cards.length}</span>
                </div>
                <div style={colSub}>{brl(valor)}</div>
                <div style={colList}>
                  {cards.length === 0 ? (
                    <div style={emptyHint}>—</div>
                  ) : cards.map((j) => {
                    const comissao = j.valor_job && j.percentual_comissao
                      ? (j.valor_job * Number(j.percentual_comissao)) / 100
                      : 0
                    const prazoDias = j.data_prazo
                      ? Math.ceil((new Date(j.data_prazo).getTime() - Date.now()) / 86400000)
                      : null
                    return (
                      <div
                        key={j.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, j.id)}
                        style={{
                          ...kanbanCard,
                          opacity: movendoId === j.id ? 0.55 : (dragId === j.id ? 0.6 : 1),
                          cursor: movendoId === j.id ? 'wait' : 'grab',
                        }}
                      >
                        <div style={{ fontWeight: 600, color: ESPRESSO, fontSize: 13 }}>{j.titulo}</div>
                        {j.cliente_id && cliNome(j.cliente_id) && (
                          <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{cliNome(j.cliente_id)}</div>
                        )}
                        {previewBriefing(j.descricao) && (
                          <div style={{ fontSize: 11, color: TEXTD, marginTop: 4, lineHeight: 1.35 }}>{previewBriefing(j.descricao)}</div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: DOURADO }}>{brl(j.valor_job ?? 0)}</span>
                          {prazoDias !== null && (
                            <span style={{
                              fontSize: 11, fontWeight: 600,
                              color: prazoDias < 0 ? RED : prazoDias <= 3 ? YELLOW : TEXTM,
                            }}>
                              {prazoDias < 0 ? `${Math.abs(prazoDias)}d atrasado` : prazoDias === 0 ? 'Hoje' : `${prazoDias}d`}
                            </span>
                          )}
                        </div>
                        {comissao > 0 && (
                          <div style={{ marginTop: 4, fontSize: 11, color: TEXTM }}>
                            Comissão: <b style={{ color: ESPRESSO }}>{brl(comissao)}</b>
                          </div>
                        )}
                        {/* Fallback touch */}
                        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <select
                            value={et.v}
                            onChange={(e) => onMover(j.id, e.target.value, et.v)}
                            disabled={movendoId === j.id}
                            aria-label="Mover para outro estágio"
                            style={moverSel}
                          >
                            {ESTAGIOS.map((d) => (
                              <option key={d.v} value={d.v}>
                                {d.v === et.v ? `· ${d.l} (atual)` : `↳ ${d.l}`}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => onEtapas(j)} style={etapasBtn}>📋 Etapas</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function JobsTabela({
  jobs, clientes, responsaveis, onNovo, onEditar, onEtapas, onExcluir,
}: {
  jobs: Job[]; clientes: Cliente[]; responsaveis: Array<{ id: string; email: string | null; full_name?: string | null }>
  onNovo: () => void; onEditar: (j: Job) => void; onEtapas: (j: Job) => void; onExcluir: (j: Job) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Jobs ({jobs.length})</h2>
        <button onClick={onNovo} style={btnPrimary}>+ Novo job</button>
      </div>
      {jobs.length === 0 ? (
        <EmptyBox titulo="Nenhum job ainda" sub="Comece criando o primeiro." />
      ) : (
        <div style={tableWrap}>
          <table style={tableSt}>
            <thead style={{ background: OFFWHITE }}>
              <tr>
                <Th>Job</Th><Th>Cliente</Th><Th>Estágio</Th>
                <Th align="right">Valor</Th><Th align="right">% Com.</Th>
                <Th>Resp.</Th><Th>Prazo</Th><Th align="center">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const cli = clientes.find((c) => c.id === j.cliente_id)
                const resp = responsaveis.find((u) => u.id === j.responsavel_id)
                const cfg = estagioCfg(j.status)
                return (
                  <tr key={j.id} style={{ borderTop: `1px solid ${BORDA}` }}>
                    <Td><strong style={{ color: ESPRESSO }}>{j.titulo}</strong></Td>
                    <Td>{cli?.nome_fantasia || cli?.nome || '—'}</Td>
                    <Td><span style={{ ...etapaChip, background: cfg.bg, color: cfg.fg }}>{cfg.l}</span></Td>
                    <Td align="right">{brl(j.valor_job ?? 0)}</Td>
                    <Td align="right">{j.percentual_comissao != null ? `${j.percentual_comissao}%` : '—'}</Td>
                    <Td>{resp ? labelUsuario(resp, responsaveis) : (j.responsavel_nome ?? '—')}</Td>
                    <Td>{j.data_prazo ?? '—'}</Td>
                    <Td align="center">
                      <button onClick={() => onEtapas(j)} style={btnSec}>Etapas</button>
                      <button onClick={() => onEditar(j)} style={{ ...btnSec, marginLeft: 4 }}>Editar</button>
                      <button onClick={() => onExcluir(j)} style={{ ...btnDanger, marginLeft: 4 }}>X</button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ClientesTabela({
  clientes, contratos, onNovo, onEditar, onExcluir,
}: {
  clientes: Cliente[]; contratos: ContratoOpt[]
  onNovo: () => void; onEditar: (c: Cliente) => void; onExcluir: (c: Cliente) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Clientes da agência ({clientes.length})</h2>
        <button onClick={onNovo} style={btnPrimary}>+ Novo cliente</button>
      </div>
      {clientes.length === 0 ? (
        <EmptyBox titulo="Nenhum cliente ainda" sub="Cadastre os clientes da agência para começar." />
      ) : (
        <div style={tableWrap}>
          <table style={tableSt}>
            <thead style={{ background: OFFWHITE }}>
              <tr>
                <Th>Cliente</Th><Th>Contato</Th><Th>Segmento</Th>
                <Th align="right">Fee mensal</Th><Th>Contrato GE</Th>
                <Th align="center">Status</Th><Th align="center">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => {
                const ct = contratos.find((x) => x.id === c.contrato_id)
                return (
                  <tr key={c.id} style={{ borderTop: `1px solid ${BORDA}` }}>
                    <Td>
                      <strong style={{ color: ESPRESSO }}>{c.nome_fantasia || c.nome}</strong>
                      {c.nome_fantasia && <div style={{ fontSize: 11, color: TEXTM }}>{c.nome}</div>}
                    </Td>
                    <Td>{c.contato_principal || '—'}<br /><span style={{ fontSize: 11, color: TEXTM }}>{c.email}</span></Td>
                    <Td>{c.segmento || '—'}</Td>
                    <Td align="right">{c.fee_mensal > 0 ? brl(c.fee_mensal) : '—'}</Td>
                    <Td>{ct ? <span style={contratoChip}>📜 {ct.numero ?? ct.id.slice(0, 8)}</span> : '—'}</Td>
                    <Td align="center">
                      <span style={{ ...statusChip, ...(c.status === 'ativo' ? statusOk : c.status === 'prospect' ? statusPend : statusOff) }}>
                        {c.status}
                      </span>
                    </Td>
                    <Td align="center">
                      <button onClick={() => onEditar(c)} style={btnSec}>Editar</button>
                      <button onClick={() => onExcluir(c)} style={{ ...btnDanger, marginLeft: 4 }}>X</button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TimesheetTabela({
  timesheets, jobs, onNovo, onExcluir,
}: { timesheets: Timesheet[]; jobs: Job[]; onNovo: () => void; onExcluir: (t: Timesheet) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Timesheet</h2>
        <button onClick={onNovo} style={btnPrimary}>+ Registrar horas</button>
      </div>
      {timesheets.length === 0 ? (
        <EmptyBox titulo="Nenhum registro de horas" sub="Registre as horas pra calcular rentabilidade." />
      ) : (
        <div style={tableWrap}>
          <table style={tableSt}>
            <thead style={{ background: OFFWHITE }}>
              <tr>
                <Th>Data</Th><Th>Job</Th><Th>Atividade</Th>
                <Th>Descrição</Th><Th align="right">Horas</Th><Th align="center">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {timesheets.slice(0, 100).map((t) => {
                const job = jobs.find((j) => j.id === t.job_id)
                return (
                  <tr key={t.id} style={{ borderTop: `1px solid ${BORDA}` }}>
                    <Td>{t.data}</Td>
                    <Td>{job?.titulo ?? '—'}</Td>
                    <Td>{t.tipo_atividade || '—'}</Td>
                    <Td>{t.descricao || '—'}</Td>
                    <Td align="right"><b style={{ color: DOURADO }}>{t.horas}h</b></Td>
                    <Td align="center"><button onClick={() => onExcluir(t)} style={btnDanger}>X</button></Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Briefing do job (texto/markdown puro — SEM HTML, sem risco de XSS) ─────
// O SIGA tem editor rico com HTML; como o projeto não tem sanitizador, guardamos
// TEXTO/Markdown leve em agency_jobs.descricao. Os botões inserem apenas marcadores
// markdown (operação de string). O editor rico com HTML sanitizado (DOMPurify) fica p/ v1.1.
function BriefingEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  function envolver(marca: string) {
    const el = ref.current; if (!el) return
    const ini = el.selectionStart ?? value.length
    const fim = el.selectionEnd ?? value.length
    const sel = value.slice(ini, fim) || 'texto'
    const novo = value.slice(0, ini) + marca + sel + marca + value.slice(fim)
    onChange(novo)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ini + marca.length, ini + marca.length + sel.length) })
  }
  function prefixarLinha(prefixo: string) {
    const el = ref.current; if (!el) return
    const ini = el.selectionStart ?? value.length
    const inicioLinha = value.lastIndexOf('\n', ini - 1) + 1
    const novo = value.slice(0, inicioLinha) + prefixo + value.slice(inicioLinha)
    onChange(novo)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ini + prefixo.length, ini + prefixo.length) })
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: ESPRESSO }}>📝 Briefing</span>
        <span style={{ fontSize: 11, color: TEXTD }}>o que precisa ser feito</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => envolver('**')} style={briefBtn} title="Negrito"><b>B</b></button>
          <button type="button" onClick={() => prefixarLinha('- ')} style={briefBtn} title="Lista">• lista</button>
        </div>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={7}
        placeholder="Descreva o job para quem vai executar: objetivo, referências, formatos, o que entregar…"
        style={briefArea}
      />
    </div>
  )
}

// ─── helpers de UI ───────────────────────────────────────────
function Kpi({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM }}>{titulo}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: destaque ? DOURADO : ESPRESSO, marginTop: 4 }}>{valor}</div>
    </div>
  )
}
function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={overlay}>
      <div style={card}>
        <div style={head}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: ESPRESSO, margin: 0 }}>{titulo}</h2>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
function Field({ label, v, on, type = 'text', multiline }: { label: string; v: unknown; on: (v: string) => void; type?: string; multiline?: boolean }) {
  return (
    <label style={lbl}>
      {label}
      {multiline ? (
        <textarea rows={3} value={(v as string) ?? ''} onChange={(e) => on(e.target.value)} style={{ ...inp, resize: 'vertical' }} />
      ) : (
        <input type={type} value={(v as string | number) ?? ''} onChange={(e) => on(e.target.value)} style={inp} />
      )}
    </label>
  )
}
function Select({ label, v, on, opts }: { label: string; v: string; on: (v: string) => void; opts: Array<[string, string]> }) {
  return (
    <label style={lbl}>
      {label}
      <select value={v} onChange={(e) => on(e.target.value)} style={inp}>
        {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  )
}
function EmptyBox({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 32, textAlign: 'center' }}>
      <p style={{ fontWeight: 600, color: ESPRESSO, margin: 0 }}>{titulo}</p>
      <p style={{ fontSize: 13, color: TEXTM, marginTop: 6 }}>{sub}</p>
    </div>
  )
}
function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <th style={{ padding: '10px 12px', fontSize: 11, color: TEXTM, textAlign: align ?? 'left', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{children}</th>
}
function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <td style={{ padding: '10px 12px', fontSize: 13, color: ESPRESSO, textAlign: align ?? 'left', verticalAlign: 'top' }}>{children}</td>
}

// ─── estilos ──────────────────────────────────────────────────
const selEmp: CSSProperties = {
  background: '#fff', border: `1px solid ${BORDA}`, color: ESPRESSO,
  borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600,
  colorScheme: 'light' as CSSProperties['colorScheme'],
}
const btnLink: CSSProperties = {
  padding: '8px 14px', border: `1px solid ${BORDA}`, borderRadius: 10,
  color: ESPRESSO, fontSize: 13, textDecoration: 'none', background: '#fff',
}
const tabBar: CSSProperties = {
  display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${BORDA}`,
}
function tabBtn(active: boolean): CSSProperties {
  return {
    border: 'none', background: 'transparent', cursor: 'pointer',
    padding: '10px 16px', fontSize: 14, fontWeight: active ? 600 : 400,
    color: active ? DOURADO : ESPRESSO,
    borderBottom: active ? `2px solid ${DOURADO}` : '2px solid transparent',
    marginBottom: -1, minHeight: 44,
  }
}
const boardWrap: CSSProperties = {
  overflowX: 'auto', paddingBottom: 8, margin: '0 -16px',
  paddingLeft: 16, paddingRight: 16, WebkitOverflowScrolling: 'touch',
}
const board: CSSProperties = {
  display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 'max-content',
}
const col: CSSProperties = {
  width: 260, flexShrink: 0, background: OFFWHITE,
  border: `1px solid ${BORDA}`, borderRadius: 12, padding: 10,
  display: 'flex', flexDirection: 'column', gap: 6,
  maxHeight: 'calc(100vh - 320px)',
}
const colHover: CSSProperties = { background: '#F3E9D8', borderColor: DOURADO }
const colHead: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
}
const colSub: CSSProperties = {
  fontSize: 11, color: TEXTM, paddingBottom: 4, borderBottom: `1px dashed ${BORDA}`,
}
const colList: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1,
}
const etapaChip: CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600,
}
const kanbanCard: CSSProperties = {
  background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 10,
  padding: 10, userSelect: 'none', transition: 'opacity .15s',
}
const moverSel: CSSProperties = {
  width: '100%', border: `1px solid ${BORDA}`, borderRadius: 6,
  padding: '4px 6px', fontSize: 11, color: ESPRESSO, background: '#fff',
  colorScheme: 'light' as CSSProperties['colorScheme'],
}
const emptyHint: CSSProperties = {
  textAlign: 'center', color: TEXTM, fontSize: 12, opacity: 0.6, padding: '12px 0',
}
const tableWrap: CSSProperties = {
  background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, overflow: 'auto',
}
const tableSt: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const overlay: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: 16, zIndex: 50, overflow: 'auto',
}
const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 720 }
const head: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }
const closeBtn: CSSProperties = { border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', minWidth: 44, minHeight: 44 }
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 10 }
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: TEXTM }
const inp: CSSProperties = {
  border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13,
  minHeight: 40, background: '#fff', color: ESPRESSO,
  colorScheme: 'light' as CSSProperties['colorScheme'],
}
const actions: CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }
const btnPrimary: CSSProperties = {
  border: 'none', background: DOURADO, color: '#fff', borderRadius: 10,
  padding: '10px 16px', cursor: 'pointer', fontWeight: 600, minHeight: 44,
}
const btnGhost: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 10,
  padding: '10px 16px', cursor: 'pointer', minHeight: 44, color: ESPRESSO,
}
const btnSec: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO,
  borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', minHeight: 32,
}
const btnDanger: CSSProperties = {
  border: '1px solid #E5C2C2', background: '#fff', color: '#9A1F1F',
  borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', minHeight: 32,
}
const toastStyle: CSSProperties = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  background: ESPRESSO, color: '#fff', padding: '10px 16px', borderRadius: 10,
  fontSize: 13, zIndex: 60, maxWidth: '90vw',
}
const statusChip: CSSProperties = {
  fontSize: 11, padding: '2px 10px', borderRadius: 999, fontWeight: 600, textTransform: 'uppercase',
}
const statusOk: CSSProperties = { background: '#DCEFD7', color: GREEN }
const statusPend: CSSProperties = { background: '#FFF3D6', color: YELLOW }
const statusOff: CSSProperties = { background: '#F0E9DE', color: TEXTM }
const contratoChip: CSSProperties = {
  display: 'inline-block', fontSize: 11, padding: '2px 8px', borderRadius: 999,
  background: '#FAEEDA', color: '#7A5A0F', fontWeight: 600,
}
const hintBox: CSSProperties = {
  background: OFFWHITE, border: `1px solid ${BORDA}`, borderRadius: 10,
  padding: 10, fontSize: 12, color: ESPRESSO, marginTop: 10,
}
const etapaRow: CSSProperties = {
  display: 'flex', gap: 10, alignItems: 'flex-start',
  background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 10, padding: 10,
}
const ordBtn: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO,
  borderRadius: 6, width: 26, height: 22, fontSize: 10, cursor: 'pointer', lineHeight: 1,
}
const etapasBtn: CSSProperties = {
  width: '100%', border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO,
  borderRadius: 6, padding: '6px 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 36,
}
const maisDetalhesBtn: CSSProperties = {
  border: 'none', background: 'transparent', color: ESPRESSO, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', padding: '8px 0', margin: '4px 0', minHeight: 40, textAlign: 'left', width: '100%',
}
const briefBtn: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO, borderRadius: 6,
  padding: '4px 8px', fontSize: 12, cursor: 'pointer', minHeight: 30,
}
const briefArea: CSSProperties = {
  width: '100%', border: `1px solid ${BORDA}`, borderRadius: 10, padding: '10px 12px',
  fontSize: 14, lineHeight: 1.5, minHeight: 140, background: '#fff', color: ESPRESSO,
  resize: 'vertical', colorScheme: 'light' as CSSProperties['colorScheme'],
}

export default function ProducaoPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Carregando…</div>}>
      <ProducaoPageInner />
    </Suspense>
  )
}
