'use client'
// LEADS · CRM de entrada da agência (P&M). Funil sobre agency_leads, escopado por company_id (RD-45).
// Etapas do kanban vêm de funil_etapa (fn_funil_etapas_listar) — configuráveis (add/editar/reordenar/excluir).
// Cadastro rápido com autocomplete de clientes GE (fn_cliente_buscar) → grava erp_cliente_id (não cliente_id,
// que tem FK p/ agency_clientes). Kanban arrasta card → etapa=chave. Ações Ganhar/Perder/Converter/Agendar.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO = '#C8941A'
const BORDA = '#E7DED3'
const TEXTM = '#6b5444'
const GREEN = '#1F5A1F'
const RED = '#7A1F1F'
const TIPO_FUNIL = 'leads'

const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// #19b · origens do lead agora são configuráveis por empresa (tabela agency_lead_origem),
// carregadas via fn_agency_origens_listar. Nada hardcoded (RD-52 — fonte única).
type Origem = { id: string; chave: string; nome: string; ordem: number; ativo: boolean }

const TIPOS_ETAPA: { v: string; l: string }[] = [
  { v: 'normal', l: 'Normal' },
  { v: 'ganho', l: 'Ganho (fecha)' },
  { v: 'perda', l: 'Perda (fecha)' },
]

type Etapa = { id: string; chave: string; rotulo: string; ordem: number; cor: string | null; tipo_etapa: string; ativo: boolean }
type Lead = {
  id: string; company_id: string; nome: string; empresa: string | null
  origem: string; canal_contato: string | null; etapa: string
  reuniao_agendada_em: string | null; valor_estimado: number | null
  responsavel_id: string | null; cliente_id: string | null; erp_cliente_id: string | null
  contato_email: string | null; contato_telefone: string | null
  motivo_perda: string | null; observacoes: string | null; criado_em: string
  etapa_desde: string | null; criado_por: string | null; deleted_at: string | null
}
// "há quanto tempo" curto: 45min · 6h · 3d 4h. Base para idade do lead e tempo na etapa.
function tempoCurto(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'agora'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24), hr = h % 24
  return hr > 0 ? `${d}d ${hr}h` : `${d}d`
}
function diasDesde(iso: string | null): number { return iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : 0 }
type FormLead = {
  empresa: string; nome: string; contato_email: string; contato_telefone: string
  canal_contato: string; origem: string; valor_estimado: string; erp_cliente_id: string | null
}
// erp_cliente_id: vínculo ao cadastro GE (erp_clientes) — NÃO agency_clientes. Corrige a FK do #1007.
const FORM0: FormLead = { empresa: '', nome: '', contato_email: '', contato_telefone: '', canal_contato: '', origem: 'trafego_pago', valor_estimado: '', erp_cliente_id: null }

export default function LeadsPage() {
  const router = useRouter()
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [leads, setLeads] = useState<Lead[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [loading, setLoading] = useState(true)
  const [respMap, setRespMap] = useState<Record<string, string>>({})
  const [uid, setUid] = useState<string | null>(null)
  // filtros (Canal removido — Demanda 3 Luzardo: só "Origem do Lead")
  const [fOrigem, setFOrigem] = useState('todas')
  const [fResp, setFResp] = useState('todos')
  const [busca, setBusca] = useState('')
  // modal + cadastro rápido
  const [novo, setNovo] = useState(false)
  const [form, setForm] = useState<FormLead>(FORM0)
  const [editando, setEditando] = useState<Lead | null>(null)   // Demanda 2: modal de edição
  const [menuLead, setMenuLead] = useState<string | null>(null) // Demanda 1: "⋯" do card (ganhar/perder/converter)
  const [reuniaoLead, setReuniaoLead] = useState<Lead | null>(null) // modal de agendamento de reunião
  const [detalheLead, setDetalheLead] = useState<Lead | null>(null) // detalhe da reunião (clique no 📅)
  const [reunioesMap, setReunioesMap] = useState<Record<string, { data: string; hora: string | null; link: string | null; local: string | null }>>({})
  const [cliTermo, setCliTermo] = useState('')
  const [cliSug, setCliSug] = useState<{ id: string; nome: string; doc: string | null }[]>([])
  const [cliBuscando, setCliBuscando] = useState(false)
  const cliTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [cfgOpen, setCfgOpen] = useState(false)
  const [origemCfgOpen, setOrigemCfgOpen] = useState(false)
  const [origens, setOrigens] = useState<Origem[]>([])

  const carregarEtapas = useCallback(async () => {
    if (!empresa) { setEtapas([]); return }
    const { data } = await supabase.rpc('fn_funil_etapas_listar', { p_company_id: empresa, p_tipo_funil: TIPO_FUNIL })
    setEtapas(((data ?? []) as Etapa[]).slice().sort((a, b) => a.ordem - b.ordem))
  }, [empresa])

  const carregarOrigens = useCallback(async () => {
    if (!empresa) { setOrigens([]); return }
    const { data } = await supabase.rpc('fn_agency_origens_listar', { p_company_id: empresa })
    setOrigens(((data ?? []) as Origem[]).slice().sort((a, b) => a.ordem - b.ordem))
  }, [empresa])
  const origemLabel = useCallback((v: string) => origens.find((o) => o.chave === v)?.nome ?? v, [origens])

  const carregar = useCallback(async () => {
    if (!empresa) { setLeads([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('agency_leads').select('*').eq('company_id', empresa).is('deleted_at', null).order('criado_em', { ascending: false })
    const rows = (data ?? []) as Lead[]
    setLeads(rows)
    // PM-QW #14 · nomes via RPC do tenant (RD-26): from('users') direto vem VAZIO p/ não-admin (RLS)
    // → o nome do responsável nunca aparecia. fn_usuarios_da_empresa é SECURITY DEFINER e resolve.
    const { data: us } = await supabase.rpc('fn_usuarios_da_empresa', { p_company_id: empresa })
    const m: Record<string, string> = {}
    for (const u of (us ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      m[u.id] = u.full_name || (u.email ? u.email.split('@')[0] : '') || '—'
    }
    setRespMap(m)
    // reuniões vinculadas (erp_agendamento comercial · dados.lead_id) → mapa por lead (a mais recente)
    const { data: ags } = await supabase.from('erp_agendamento')
      .select('data, hora_inicio, link_reuniao, local, dados')
      .eq('company_id', empresa).eq('origem_modulo', 'comercial')
      .order('data', { ascending: false })
    const rm: Record<string, { data: string; hora: string | null; link: string | null; local: string | null }> = {}
    for (const a of (ags ?? []) as { data: string; hora_inicio: string | null; link_reuniao: string | null; local: string | null; dados: { lead_id?: string } | null }[]) {
      const lid = a.dados?.lead_id
      if (lid && !rm[lid]) rm[lid] = { data: a.data, hora: a.hora_inicio, link: a.link_reuniao, local: a.local }
    }
    setReunioesMap(rm)
    setLoading(false)
  }, [empresa])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { void carregarEtapas() }, [carregarEtapas])
  useEffect(() => { void carregarOrigens() }, [carregarOrigens])
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null)) }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])

  const etapaCfg = useCallback((chave: string) => etapas.find((e) => e.chave === chave) ?? { id: chave, chave, rotulo: chave, ordem: 999, cor: OFFWHITE, tipo_etapa: 'normal', ativo: true }, [etapas])
  const fechadas = useMemo(() => new Set(etapas.filter((e) => e.tipo_etapa !== 'normal').map((e) => e.chave)), [etapas])
  const ganhoChaves = useMemo(() => new Set(etapas.filter((e) => e.tipo_etapa === 'ganho').map((e) => e.chave)), [etapas])
  const perdaChave = useMemo(() => etapas.find((e) => e.tipo_etapa === 'perda')?.chave ?? 'perdido', [etapas])

  const responsaveis = useMemo(() => Array.from(new Set(leads.map((l) => l.responsavel_id).filter(Boolean))) as string[], [leads])
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return leads.filter((l) =>
      (fOrigem === 'todas' || l.origem === fOrigem) &&
      (fResp === 'todos' || l.responsavel_id === fResp) &&
      (!q || [l.nome, l.empresa, l.contato_email, l.contato_telefone].some((x) => (x ?? '').toLowerCase().includes(q))))
  }, [leads, fOrigem, fResp, busca])
  const kpis = useMemo(() => ({
    total: leads.length,
    emAberto: leads.filter((l) => !fechadas.has(l.etapa)).length,
    ganhos: leads.filter((l) => ganhoChaves.has(l.etapa)).length,
    pipeline: leads.filter((l) => !fechadas.has(l.etapa)).reduce((s, l) => s + Number(l.valor_estimado ?? 0), 0),
  }), [leads, fechadas, ganhoChaves])

  // ── autocomplete de cliente (GE) ────────────────────────────────────────────
  const buscarClientes = useCallback(async (t: string) => {
    if (!empresa) return
    const q = t.trim()
    if (q.length < 2) { setCliSug([]); return }
    setCliBuscando(true)
    try {
      const { data } = await supabase.rpc('fn_cliente_buscar', { p_company_id: empresa, p_termo: q, p_limit: 8 })
      const res = ((data as { resultados?: { cliente_id: string; nome: string; cnpj_cpf: string | null }[] } | null)?.resultados) ?? []
      setCliSug(res.map((r) => ({ id: r.cliente_id, nome: r.nome, doc: r.cnpj_cpf })))
    } finally { setCliBuscando(false) }
  }, [empresa])
  const onCliTermo = (v: string) => {
    setCliTermo(v); setForm((f) => ({ ...f, empresa: v, erp_cliente_id: null }))
    if (cliTimer.current) clearTimeout(cliTimer.current)
    cliTimer.current = setTimeout(() => void buscarClientes(v), 250)
  }
  async function escolherCliente(c: { id: string; nome: string }) {
    setCliSug([]); setCliTermo(c.nome)
    const { data } = await supabase.from('erp_clientes').select('email, telefone, celular, whatsapp').eq('id', c.id).maybeSingle()
    const d = (data ?? {}) as { email?: string | null; telefone?: string | null; celular?: string | null; whatsapp?: string | null }
    setForm((f) => ({ ...f, empresa: c.nome, erp_cliente_id: c.id, contato_email: d.email ?? f.contato_email, contato_telefone: d.telefone || d.celular || d.whatsapp || f.contato_telefone }))
    setToast('Cliente vinculado — dados preenchidos.')
  }
  async function criarClienteInline() {
    if (!empresa) return
    const nome = (cliTermo || form.empresa).trim()
    if (!nome) { setToast('Digite o nome/empresa do cliente.'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_cliente_criar_inline', { p_company_id: empresa, p_nome: nome, p_cpf_cnpj: null, p_extra: { email: form.contato_email || null, telefone: form.contato_telefone || null } })
      if (error) { setToast(`Erro: ${error.message}`); return }
      const cid = data as string | null
      setForm((f) => ({ ...f, empresa: nome, erp_cliente_id: cid })); setCliSug([]); setCliTermo(nome)
      setToast('Cliente CRIADO na GE e vinculado.')
    } finally { setBusy(false) }
  }

  async function criar() {
    if (!empresa) return
    if (!form.empresa.trim() && !form.nome.trim()) { setToast('Informe a empresa ou o contato.'); return }
    setBusy(true)
    const { error } = await supabase.rpc('fn_agency_lead_criar', {
      p_campos: {
        company_id: empresa, empresa: form.empresa.trim() || null, nome: form.nome.trim() || null,
        contato_email: form.contato_email.trim() || null, contato_telefone: form.contato_telefone.trim() || null,
        canal_contato: form.canal_contato.trim() || null, origem: form.origem,
        valor_estimado: form.valor_estimado || null,
        erp_cliente_id: form.erp_cliente_id, cliente_id: null, responsavel_id: uid,
      },
    })
    setBusy(false)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setNovo(false); setForm(FORM0); setCliTermo(''); setCliSug([])
    setToast('Lead CRIADO.'); void carregar()
  }

  async function moverEtapa(l: Lead, etapa: string) {
    if (l.etapa === etapa) return
    await supabase.from('agency_leads').update({ etapa, atualizado_em: new Date().toISOString() }).eq('id', l.id)
    setLeads((arr) => arr.map((x) => (x.id === l.id ? { ...x, etapa } : x)))   // otimista
    setToast(`Movido para ${etapaCfg(etapa).rotulo}.`)
  }
  async function ganhar(l: Lead) {
    if (!confirm(`Marcar "${l.nome}" como GANHO?\nCria o cliente na agência e GERA uma proposta.`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_lead_ganhar', { p_lead_id: l.id })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('GANHOU → proposta gerada.'); void carregar()
    setTimeout(() => router.push('/dashboard/pm/propostas'), 700)
  }
  async function perder(l: Lead) {
    const motivo = prompt('Motivo da perda (obrigatório):', '')
    if (motivo === null) return
    if (!motivo.trim()) { setToast('Informe o motivo da perda.'); return }
    await supabase.from('agency_leads').update({ etapa: perdaChave, motivo_perda: motivo.trim(), atualizado_em: new Date().toISOString() }).eq('id', l.id)
    setToast('Marcado como PERDIDO.'); void carregar()
  }
  // Converter: liga/cria um cadastro GE (erp_clientes) → erp_cliente_id (não cliente_id/FK agency) e vai às Propostas.
  async function converter(l: Lead) {
    if (!empresa) return
    setBusy(true)
    try {
      let cid = l.erp_cliente_id
      if (!cid) {
        const nome = (l.empresa || l.nome || '').trim()
        if (!nome) { setToast('Lead sem empresa/contato para criar cliente.'); return }
        const { data, error } = await supabase.rpc('fn_cliente_criar_inline', { p_company_id: empresa, p_nome: nome, p_cpf_cnpj: null, p_extra: { email: l.contato_email || null, telefone: l.contato_telefone || null } })
        if (error) { setToast(`Erro: ${error.message}`); return }
        cid = data as string | null
        if (cid) await supabase.from('agency_leads').update({ erp_cliente_id: cid, atualizado_em: new Date().toISOString() }).eq('id', l.id)
      }
      setToast('Cliente ligado ao lead → Propostas.'); void carregar()
      setTimeout(() => router.push('/dashboard/pm/propostas'), 700)
    } finally { setBusy(false) }
  }
  // Reunião: abre o modal de agendamento (substitui o prompt cru).
  function agendar(l: Lead) { setReuniaoLead(l) }

  // Proposta: abre a proposta vinculada ao lead; se não houver, cria uma vinculada (nunca órfã) e abre.
  async function proposta(l: Lead) {
    setBusy(true)
    try {
      const { data } = await supabase.rpc('fn_agency_lead_proposta', { p_lead_id: l.id })
      const r = data as { ok?: boolean; proposta?: { id: string } | null } | null
      if (r?.ok && r.proposta?.id) { router.push(`/dashboard/pm/propostas?proposta=${r.proposta.id}`); return }
      // sem proposta → cria vinculada + pré-preenchida
      const { data: c, error } = await supabase.rpc('fn_agency_lead_proposta_criar', { p_lead_id: l.id })
      const cr = c as { ok?: boolean; id?: string; erro?: string } | null
      if (error || !cr?.ok || !cr.id) { setToast('Erro ao criar proposta: ' + (error?.message ?? cr?.erro ?? 'falhou')); return }
      // criar proposta = avançar: move o lead pra etapa "proposta" se existir no funil
      const propChave = etapas.find((e) => e.chave === 'proposta')?.chave
      if (propChave && l.etapa !== propChave) {
        await supabase.from('agency_leads').update({ etapa: propChave, atualizado_em: new Date().toISOString() }).eq('id', l.id)
      }
      router.push(`/dashboard/pm/propostas?proposta=${cr.id}`)
    } finally { setBusy(false) }
  }

  // Excluir lead = soft-delete (RD-54/55: não some do banco). Gate no servidor
  // (responsável/criador/admin) — mensagem clara se não puder.
  async function excluirLead(l: Lead) {
    if (typeof window !== 'undefined' && !window.confirm(`Excluir o lead "${l.empresa || l.nome}"?\nEle sai do Kanban (pode ser recuperado depois).`)) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_crm_lead_excluir', { p_lead_id: l.id })
      const r = data as { ok?: boolean; erro?: string; orientacao?: string } | null
      if (error || !r?.ok) {
        setToast(r?.orientacao ?? (r?.erro === 'sem_permissao'
          ? 'Só o responsável, quem criou ou um admin podem excluir este lead.'
          : 'Erro ao excluir: ' + (error?.message ?? r?.erro ?? 'falhou')))
        return
      }
      setToast('Lead excluído.')
      await carregar()
    } finally { setBusy(false) }
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🎯 P&amp;M · Comercial</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Leads · CRM de entrada</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Funil da agência: da prospecção ao ganho. Arraste o card entre as etapas.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setCfgOpen(true)} style={btnGhost} data-testid="funil-config" title="Configurar etapas do funil">⚙️ Configurar funil</button>
            <button onClick={() => setOrigemCfgOpen(true)} style={btnGhost} data-testid="origem-config" title="Configurar origens do lead">⚙️ Origens</button>
            <button onClick={() => { setForm(FORM0); setCliTermo(''); setCliSug([]); setNovo(true) }} style={btnPri} data-testid="lead-novo">+ Novo lead</button>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Leads" v={String(kpis.total)} />
          <Kpi l="Em aberto" v={String(kpis.emAberto)} />
          <Kpi l="Ganhos" v={String(kpis.ganhos)} />
          <Kpi l="Pipeline" v={brl(kpis.pipeline)} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar contato/empresa/email…" style={{ ...inp, minWidth: 220 }} />
          <select value={fOrigem} onChange={(e) => setFOrigem(e.target.value)} style={inp} aria-label="Origem">
            <option value="todas">Origem: todas</option>
            {origens.map((o) => <option key={o.chave} value={o.chave}>{o.nome}</option>)}
          </select>
          <select value={fResp} onChange={(e) => setFResp(e.target.value)} style={inp} aria-label="Responsável">
            <option value="todos">Responsável: todos</option>
            {responsaveis.map((r) => <option key={r} value={r}>{respMap[r] ?? '—'}</option>)}
          </select>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : etapas.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>
              Nenhuma etapa configurada. <button onClick={() => setCfgOpen(true)} style={{ ...btnSec, display: 'inline-block', marginLeft: 6 }}>Configurar funil</button>
            </div>
          ) : (
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
            {etapas.map((col) => {
              const items = filtrados.filter((l) => l.etapa === col.chave)
              const soma = items.reduce((s, l) => s + Number(l.valor_estimado ?? 0), 0)
              return (
                <div key={col.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { const l = leads.find((x) => x.id === dragId); if (l) void moverEtapa(l, col.chave); setDragId(null) }}
                  style={{ minWidth: 250, width: 250, flex: '0 0 auto', background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 8px' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: col.cor ?? OFFWHITE, border: `1px solid ${BORDA}` }} />
                    <strong style={{ fontSize: 13 }}>{col.rotulo}</strong>
                    {col.tipo_etapa !== 'normal' && <span style={{ fontSize: 9, fontWeight: 700, color: col.tipo_etapa === 'ganho' ? GREEN : RED }}>{col.tipo_etapa === 'ganho' ? '✓' : '✕'}</span>}
                    <span style={{ fontSize: 11, color: TEXTM, marginLeft: 'auto' }}>{items.length}{soma > 0 ? ` · ${brl(soma)}` : ''}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 20 }}>
                    {items.map((l) => {
                      const fim = fechadas.has(l.etapa)
                      // semáforo de lead parado (confirmado c/ CEO): amarelo ≥3d, vermelho ≥7d na etapa.
                      const dEtapa = diasDesde(l.etapa_desde)
                      const corEtapa = dEtapa >= 7 ? RED : dEtapa >= 3 ? DOURADO : TEXTM
                      return (
                        <div key={l.id} draggable onDragStart={() => setDragId(l.id)} onDragEnd={() => setDragId(null)}
                          data-testid="lead-card"
                          style={{ background: OFFWHITE, border: `1px solid ${BORDA}`, borderRadius: 10, padding: '9px 10px', cursor: 'grab' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <strong style={{ fontSize: 13 }}>{l.empresa || l.nome}</strong>
                            {(l.erp_cliente_id || l.cliente_id) && <span title="Cliente cadastrado na GE" style={{ fontSize: 9.5, fontWeight: 700, color: GREEN, background: '#DCEFD7', borderRadius: 999, padding: '1px 6px' }}>✓ cliente</span>}
                          </div>
                          {l.empresa && l.nome && l.nome !== l.empresa && <div style={{ fontSize: 11.5, color: TEXTM }}>{l.nome}</div>}
                          <div style={{ fontSize: 11, color: TEXTM, marginTop: 3 }}>
                            {origemLabel(l.origem)}{l.canal_contato ? ` · ${l.canal_contato}` : ''}{l.valor_estimado ? ` · ${brl(Number(l.valor_estimado))}` : ''}
                          </div>
                          {(l.contato_email || l.contato_telefone) && <div style={{ fontSize: 10.5, color: TEXTM, marginTop: 2 }}>{[l.contato_telefone, l.contato_email].filter(Boolean).join(' · ')}</div>}
                          {l.responsavel_id && respMap[l.responsavel_id] && <div style={{ fontSize: 10.5, color: TEXTM, marginTop: 2 }}>resp: {respMap[l.responsavel_id]}</div>}
                          {l.criado_por && l.criado_por !== l.responsavel_id && respMap[l.criado_por] && <div style={{ fontSize: 10.5, color: TEXTM }}>criado por: {respMap[l.criado_por]}</div>}
                          <div style={{ fontSize: 10, color: TEXTM, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <span title={new Date(l.criado_em).toLocaleString('pt-BR')}>🕒 criado há {tempoCurto(l.criado_em)}</span>
                            {!fim && <span style={{ color: corEtapa, fontWeight: dEtapa >= 3 ? 700 : 400 }} title={dEtapa >= 7 ? 'Lead parado há muito tempo nesta etapa' : dEtapa >= 3 ? 'Atenção: tempo elevado nesta etapa' : undefined}>⏱ nesta etapa há {tempoCurto(l.etapa_desde)}</span>}
                          </div>
                          {l.reuniao_agendada_em && (
                            <div style={{ fontSize: 10.5, color: DOURADO, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <button onClick={(e) => { e.stopPropagation(); setDetalheLead(l) }} title="Ver detalhes da reunião"
                                style={{ background: 'none', border: 'none', color: DOURADO, fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 10.5 }}>
                                📅 {new Date(l.reuniao_agendada_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </button>
                              {reunioesMap[l.id]?.link && (
                                <a href={reunioesMap[l.id]!.link!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                  style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#2F5AA8', borderRadius: 6, padding: '1px 7px', textDecoration: 'none' }}>▶ entrar</a>
                              )}
                              {reunioesMap[l.id]?.local && <span style={{ color: TEXTM }}>· {reunioesMap[l.id]!.local}</span>}
                            </div>
                          )}
                          {fim && l.motivo_perda && <div style={{ fontSize: 10.5, color: RED, marginTop: 2 }}>motivo: {l.motivo_perda}</div>}
                          {fim && (
                            <div style={{ marginTop: 6 }}>
                              <button disabled={busy} onClick={() => void excluirLead(l)} style={chip(RED)}>🗑 Excluir</button>
                            </div>
                          )}
                          {!fim && (
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7, alignItems: 'center' }}>
                              {/* Demanda 1: ações do estágio no rodapé = Reunião + Proposta. Demanda 2: Editar. */}
                              <button onClick={() => agendar(l)} style={chip(DOURADO)}>📅 Reunião</button>
                              <button disabled={busy} onClick={() => void proposta(l)} style={chip(ESPRESSO)}>📄 Proposta</button>
                              <button onClick={() => setEditando(l)} style={chip('#2F5AA8')}>✏️ Editar</button>
                              <button onClick={() => setMenuLead(menuLead === l.id ? null : l.id)} title="Mais ações" style={{ ...chip(TEXTM), fontWeight: 700 }}>⋯</button>
                              {menuLead === l.id && (
                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', width: '100%', marginTop: 2 }}>
                                  <button disabled={busy} onClick={() => { setMenuLead(null); ganhar(l) }} style={chip(GREEN)}>✓ Ganhar</button>
                                  <button onClick={() => { setMenuLead(null); perder(l) }} style={chip(RED)}>✕ Perder</button>
                                  <button disabled={busy} onClick={() => { setMenuLead(null); void converter(l) }} style={chip(ESPRESSO)}>→ Converter</button>
                                  <button disabled={busy} onClick={() => { setMenuLead(null); void excluirLead(l) }} style={chip(RED)}>🗑 Excluir</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {novo && (
        <div style={overlay} onClick={() => setNovo(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Novo lead</h2>
            <p style={{ fontSize: 12, color: TEXTM, margin: '0 0 10px' }}>Busque um cliente cadastrado (preenche sozinho) ou digite um novo.</p>

            <label style={lbl}>Empresa / cliente
              <div style={{ position: 'relative' }}>
                <input style={{ ...inp, width: '100%' }} value={cliTermo || form.empresa} onChange={(e) => onCliTermo(e.target.value)} placeholder="Buscar cliente da GE ou digitar novo" data-testid="lead-cliente-busca" />
                {(cliSug.length > 0 || cliBuscando || (cliTermo.trim().length >= 2 && !form.erp_cliente_id)) && (
                  <div style={{ position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, marginTop: 2, background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 8, boxShadow: '0 6px 16px rgba(61,35,20,.12)', maxHeight: 200, overflowY: 'auto' }}>
                    {cliBuscando && <div style={{ padding: '8px 10px', fontSize: 12, color: TEXTM }}>Buscando…</div>}
                    {cliSug.map((c) => (
                      <button key={c.id} type="button" onMouseDown={(e) => { e.preventDefault(); void escolherCliente(c) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '8px 10px', fontSize: 13, cursor: 'pointer', color: ESPRESSO }}>
                        {c.nome}{c.doc ? <span style={{ color: TEXTM, fontSize: 11, marginLeft: 6 }}>· {c.doc}</span> : null}
                      </button>
                    ))}
                    <button type="button" disabled={busy} onMouseDown={(e) => { e.preventDefault(); void criarClienteInline() }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderTop: `1px solid ${BORDA}`, background: 'rgba(200,148,26,.08)', padding: '8px 10px', fontSize: 12.5, cursor: 'pointer', color: DOURADO, fontWeight: 700 }}>
                      + Cadastrar cliente &quot;{(cliTermo || form.empresa).trim()}&quot; na GE
                    </button>
                  </div>
                )}
              </div>
            </label>
            {form.erp_cliente_id && <div style={{ fontSize: 11, color: GREEN, marginTop: 4 }}>✓ vinculado a um cliente cadastrado</div>}

            <label style={lbl}>Contato (nome)<input style={inp} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Pessoa de contato" /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={lbl}>Email<input style={inp} value={form.contato_email} onChange={(e) => setForm({ ...form, contato_email: e.target.value })} /></label>
              <label style={lbl}>Telefone<input style={inp} value={form.contato_telefone} onChange={(e) => setForm({ ...form, contato_telefone: e.target.value })} /></label>
            </div>
            {/* QW6 (#19a): "Canal" removido — o banco tem só `origem`. Um campo só, sem duplicar conceito. */}
            <label style={lbl}>Origem do Lead
              <select style={inp} value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })}>
                {!origens.some((o) => o.chave === form.origem) && form.origem && (
                  <option value={form.origem}>{origemLabel(form.origem)}</option>
                )}
                {origens.map((o) => <option key={o.chave} value={o.chave}>{o.nome}</option>)}
              </select>
              <button type="button" onClick={() => { setNovo(false); setOrigemCfgOpen(true) }}
                style={{ background: 'none', border: 'none', color: DOURADO, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '4px 0 0', textAlign: 'left' }}>
                ⚙️ Gerenciar origens
              </button>
            </label>
            <label style={lbl}>Valor Total Estimado do Contrato (R$)<input style={inp} type="number" inputMode="decimal" value={form.valor_estimado} onChange={(e) => setForm({ ...form, valor_estimado: e.target.value })} /></label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setNovo(false)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={criar} style={btnPri} data-testid="lead-salvar">{busy ? 'Salvando…' : 'CRIAR'}</button>
            </div>
          </div>
        </div>
      )}

      {cfgOpen && (
        <ConfigFunil empresa={empresa} etapas={etapas} leads={leads}
          onClose={() => setCfgOpen(false)}
          onChange={async () => { await carregarEtapas() }}
          setToast={setToast} />
      )}

      {origemCfgOpen && empresa && (
        <ConfigOrigens empresa={empresa} origens={origens} leads={leads}
          onClose={() => setOrigemCfgOpen(false)}
          onChange={async () => { await carregarOrigens() }}
          setToast={setToast} />
      )}

      {editando && empresa && (
        <EditarLeadModal lead={editando} empresa={empresa} origens={origens}
          onClose={() => setEditando(null)} onSaved={() => { setEditando(null); void carregar() }} />
      )}

      {detalheLead && (
        <ReuniaoDetalheModal lead={detalheLead} info={reunioesMap[detalheLead.id] ?? null}
          onClose={() => setDetalheLead(null)}
          onVerAgenda={(d) => { setDetalheLead(null); router.push(`/dashboard/pm/agenda?data=${d}`) }}
          onReagendar={() => { const l = detalheLead; setDetalheLead(null); setReuniaoLead(l) }} />
      )}

      {reuniaoLead && empresa && (
        <ReuniaoModal lead={reuniaoLead} empresa={empresa} uid={uid}
          reuniaoChave={etapas.find((e) => e.chave === 'reuniao_agendada')?.chave ?? null}
          onClose={() => setReuniaoLead(null)} onSaved={() => { setReuniaoLead(null); void carregar() }} setToast={setToast} />
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

// ── Configurar funil: add / editar / reordenar (arrastar) / excluir ─────────────
function ConfigFunil({ empresa, etapas, leads, onClose, onChange, setToast }: {
  empresa: string; etapas: Etapa[]; leads: Lead[]
  onClose: () => void; onChange: () => Promise<void>; setToast: (s: string) => void
}) {
  const [rows, setRows] = useState<Etapa[]>(etapas)
  const [novoRot, setNovoRot] = useState('')
  const [novoCor, setNovoCor] = useState('#F0E9DE')
  const [novoTipo, setNovoTipo] = useState('normal')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<string | null>(null)
  useEffect(() => { setRows(etapas) }, [etapas])

  const contagem = useCallback((chave: string) => leads.filter((l) => l.etapa === chave).length, [leads])

  async function salvar(e: Etapa) {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_funil_etapa_salvar', {
      p_campos: { id: e.id, rotulo: e.rotulo, ordem: e.ordem, cor: e.cor, tipo_etapa: e.tipo_etapa },
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Etapa SALVA.'); await onChange()
  }
  async function adicionar() {
    if (!novoRot.trim()) { setToast('Informe o rótulo da etapa.'); return }
    setBusy(true)
    const maxOrdem = rows.reduce((m, r) => Math.max(m, r.ordem), 0)
    const { data, error } = await supabase.rpc('fn_funil_etapa_salvar', {
      p_campos: { company_id: empresa, tipo_funil: TIPO_FUNIL, rotulo: novoRot.trim(), cor: novoCor, tipo_etapa: novoTipo, ordem: maxOrdem + 10 },
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setNovoRot(''); setNovoCor('#F0E9DE'); setNovoTipo('normal')
    setToast('Etapa ADICIONADA.'); await onChange()
  }
  async function excluir(e: Etapa) {
    const n = contagem(e.chave)
    if (n > 0) { setToast(`Mova os ${n} lead(s) antes de excluir "${e.rotulo}".`); return }
    if (!confirm(`Excluir a etapa "${e.rotulo}"?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_funil_etapa_excluir', { p_id: e.id })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; qtd?: number } | null
    if (error || !j?.ok) {
      if (j?.erro === 'etapa_com_registros') setToast(`Mova os ${j.qtd} lead(s) antes de excluir "${e.rotulo}".`)
      else setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`)
      return
    }
    setToast('Etapa EXCLUÍDA.'); await onChange()
  }
  // reordenar por arrasto → reescreve ordem (índice*10) e persiste as que mudaram
  async function soltarSobre(alvo: Etapa) {
    if (!drag || drag === alvo.id) { setDrag(null); return }
    const arr = rows.slice()
    const from = arr.findIndex((r) => r.id === drag)
    const to = arr.findIndex((r) => r.id === alvo.id)
    if (from < 0 || to < 0) { setDrag(null); return }
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    const renum = arr.map((r, i) => ({ ...r, ordem: (i + 1) * 10 }))
    setRows(renum); setDrag(null); setBusy(true)
    try {
      for (const r of renum) {
        const orig = rows.find((x) => x.id === r.id)
        if (orig && orig.ordem !== r.ordem) {
          await supabase.rpc('fn_funil_etapa_salvar', { p_campos: { id: r.id, rotulo: r.rotulo, ordem: r.ordem, cor: r.cor, tipo_etapa: r.tipo_etapa } })
        }
      }
      setToast('Ordem ATUALIZADA.'); await onChange()
    } finally { setBusy(false) }
  }

  function patch(id: string, p: Partial<Etapa>) { setRows((arr) => arr.map((r) => (r.id === id ? { ...r, ...p } : r))) }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Configurar funil</h2>
          <button onClick={onClose} style={btnSec}>Fechar</button>
        </div>
        <p style={{ fontSize: 12, color: TEXTM, margin: '0 0 12px' }}>Arraste para reordenar. Etapas “Ganho”/“Perda” fecham o lead. Não dá para excluir etapa com leads.</p>

        <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          {rows.map((e) => {
            const n = contagem(e.chave)
            return (
              <div key={e.id} draggable onDragStart={() => setDrag(e.id)} onDragEnd={() => setDrag(null)}
                onDragOver={(ev) => ev.preventDefault()} onDrop={() => void soltarSobre(e)}
                style={{ display: 'grid', gridTemplateColumns: '18px 30px 1fr 120px auto auto', gap: 6, alignItems: 'center', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '6px 8px', background: drag === e.id ? '#FBF6EA' : '#fff' }}>
                <span title="Arraste para reordenar" style={{ cursor: 'grab', color: TEXTM, fontSize: 14 }}>⋮⋮</span>
                <input type="color" value={e.cor ?? '#F0E9DE'} onChange={(ev) => patch(e.id, { cor: ev.target.value })} onBlur={() => void salvar(e)} style={{ width: 30, height: 30, border: `1px solid ${BORDA}`, borderRadius: 6, background: '#fff', padding: 0, cursor: 'pointer' }} title="Cor" />
                <input value={e.rotulo} onChange={(ev) => patch(e.id, { rotulo: ev.target.value })} onBlur={() => void salvar(e)} style={{ ...inp, minHeight: 34 }} />
                <select value={e.tipo_etapa} onChange={(ev) => { patch(e.id, { tipo_etapa: ev.target.value }); }} onBlur={() => void salvar(e)} style={{ ...inp, minHeight: 34 }}>
                  {TIPOS_ETAPA.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
                <span style={{ fontSize: 11, color: TEXTM, textAlign: 'right', minWidth: 44 }}>{n} lead{n === 1 ? '' : 's'}</span>
                <button disabled={busy} onClick={() => void excluir(e)} title={n > 0 ? `Mova os ${n} leads antes` : 'Excluir'} style={{ ...btnSec, borderColor: RED, color: RED, minHeight: 34, opacity: n > 0 ? 0.5 : 1 }}>✕</button>
              </div>
            )
          })}
          {rows.length === 0 && <div style={{ fontSize: 12, color: TEXTM, padding: 8 }}>Sem etapas — adicione a primeira abaixo.</div>}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: DOURADO, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Adicionar etapa</div>
        <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 120px auto', gap: 6, alignItems: 'center' }}>
          <input type="color" value={novoCor} onChange={(e) => setNovoCor(e.target.value)} style={{ width: 30, height: 34, border: `1px solid ${BORDA}`, borderRadius: 6, background: '#fff', padding: 0, cursor: 'pointer' }} title="Cor" />
          <input value={novoRot} onChange={(e) => setNovoRot(e.target.value)} placeholder="Rótulo da etapa (ex.: Qualificação)" style={{ ...inp, minHeight: 34 }} />
          <select value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)} style={{ ...inp, minHeight: 34 }}>
            {TIPOS_ETAPA.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <button disabled={busy} onClick={() => void adicionar()} style={{ ...btnPri, minHeight: 34, padding: '6px 12px' }}>+ Add</button>
        </div>
      </div>
    </div>
  )
}

// ── #19b · Configurar origens do lead: add / renomear / ativar / excluir (guarda leads) ──────────
function ConfigOrigens({ empresa, origens, leads, onClose, onChange, setToast }: {
  empresa: string; origens: Origem[]; leads: Lead[]
  onClose: () => void; onChange: () => Promise<void>; setToast: (s: string) => void
}) {
  // Carrega TODAS (inclusive inativas) direto da tabela — o RPC de listagem só traz ativas.
  const [rows, setRows] = useState<Origem[]>(origens)
  const [novo, setNovo] = useState('')
  const [busy, setBusy] = useState(false)

  const recarregar = useCallback(async () => {
    const { data } = await supabase.from('agency_lead_origem').select('id, chave, nome, ordem, ativo')
      .eq('company_id', empresa).order('ordem')
    setRows(((data ?? []) as Origem[]))
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void recarregar() }, [recarregar])

  const contagem = useCallback((chave: string) => leads.filter((l) => l.origem === chave).length, [leads])
  function patch(id: string, p: Partial<Origem>) { setRows((arr) => arr.map((r) => (r.id === id ? { ...r, ...p } : r))) }

  async function salvar(o: Origem) {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_origem_salvar', {
      p_campos: { id: o.id, nome: o.nome, ordem: o.ordem, ativo: o.ativo },
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    await recarregar(); await onChange()
  }
  async function adicionar() {
    if (!novo.trim()) { setToast('Informe o nome da origem.'); return }
    setBusy(true)
    const maxOrdem = rows.reduce((m, r) => Math.max(m, r.ordem), 0)
    const { data, error } = await supabase.rpc('fn_agency_origem_salvar', {
      p_campos: { company_id: empresa, nome: novo.trim(), ordem: maxOrdem + 10 },
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setNovo(''); setToast('Origem ADICIONADA.'); await recarregar(); await onChange()
  }
  async function excluir(o: Origem) {
    const n = contagem(o.chave)
    if (n > 0) { setToast(`${n} lead(s) usam "${o.nome}". Desative em vez de excluir.`); return }
    if (!confirm(`Excluir a origem "${o.nome}"?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_origem_excluir', { p_id: o.id })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; qtd?: number } | null
    if (error || !j?.ok) {
      if (j?.erro === 'origem_com_leads') setToast(`${j.qtd} lead(s) usam "${o.nome}". Desative em vez de excluir.`)
      else setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`)
      return
    }
    setToast('Origem EXCLUÍDA.'); await recarregar(); await onChange()
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Origens do lead</h2>
          <button onClick={onClose} style={btnSec}>Fechar</button>
        </div>
        <p style={{ fontSize: 12, color: TEXTM, margin: '0 0 12px' }}>De onde os leads chegam. Desative uma origem para escondê-la sem apagar histórico. Origem em uso não pode ser excluída.</p>

        <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          {rows.map((o) => {
            const n = contagem(o.chave)
            return (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '6px 8px', background: o.ativo ? '#fff' : '#F6F1E8' }}>
                <input value={o.nome} onChange={(ev) => patch(o.id, { nome: ev.target.value })} onBlur={() => void salvar(o)} style={{ ...inp, minHeight: 34 }} />
                <span style={{ fontSize: 11, color: TEXTM, textAlign: 'right', minWidth: 44 }}>{n} lead{n === 1 ? '' : 's'}</span>
                <button disabled={busy} onClick={() => void salvar({ ...o, ativo: !o.ativo })} title={o.ativo ? 'Desativar' : 'Ativar'} style={{ ...btnSec, minHeight: 34, color: o.ativo ? GREEN : TEXTM }}>{o.ativo ? 'Ativa' : 'Inativa'}</button>
                <button disabled={busy} onClick={() => void excluir(o)} title={n > 0 ? `${n} leads usam` : 'Excluir'} style={{ ...btnSec, borderColor: RED, color: RED, minHeight: 34, opacity: n > 0 ? 0.5 : 1 }}>✕</button>
              </div>
            )
          })}
          {rows.length === 0 && <div style={{ fontSize: 12, color: TEXTM, padding: 8 }}>Sem origens — adicione a primeira abaixo.</div>}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: DOURADO, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Adicionar origem</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
          <input value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void adicionar() }} placeholder="Nome da origem (ex.: Feira, LinkedIn)" style={{ ...inp, minHeight: 34 }} />
          <button disabled={busy} onClick={() => void adicionar()} style={{ ...btnPri, minHeight: 34, padding: '6px 12px' }}>+ Add</button>
        </div>
      </div>
    </div>
  )
}

// ── Detalhe da reunião (clique no 📅 do card): hora/local + ▶ Entrar + Ver na Agenda + Reagendar ──
function ReuniaoDetalheModal({ lead, info, onClose, onVerAgenda, onReagendar }: {
  lead: Lead; info: { data: string; hora: string | null; link: string | null; local: string | null } | null
  onClose: () => void; onVerAgenda: (data: string) => void; onReagendar: () => void
}) {
  const quando = lead.reuniao_agendada_em ? new Date(lead.reuniao_agendada_em).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const dataAgenda = info?.data ?? (lead.reuniao_agendada_em ? lead.reuniao_agendada_em.slice(0, 10) : '')
  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>📅 Reunião</h2>
          <button onClick={onClose} style={btnSec}>Fechar</button>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: ESPRESSO }}>{lead.empresa || lead.nome}</div>
        <div style={{ fontSize: 12.5, color: TEXTM, marginTop: 4 }}>🕒 {quando}</div>
        {info?.local && <div style={{ fontSize: 12.5, color: TEXTM, marginTop: 2 }}>📍 {info.local}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {info?.link && (
            <a href={info.link} target="_blank" rel="noopener noreferrer" style={{ background: '#166534', color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>▶ Entrar na reunião</a>
          )}
          {dataAgenda && <button onClick={() => onVerAgenda(dataAgenda)} style={{ background: '#2F5AA8', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>📆 Ver na Agenda</button>}
          <button onClick={onReagendar} style={btnGhost}>Reagendar</button>
        </div>
        {!info?.link && <div style={{ fontSize: 11, color: TEXTM, marginTop: 10 }}>Sem link de reunião. Use &quot;Reagendar&quot; para adicionar o link do Meet/Zoom.</div>}
      </div>
    </div>
  )
}

// ── Reunião do lead · modal completo (substitui o prompt): data/hora + local + link + obs ─────────
function ReuniaoModal({ lead, empresa, uid, reuniaoChave, onClose, onSaved, setToast }: {
  lead: Lead; empresa: string; uid: string | null; reuniaoChave: string | null
  onClose: () => void; onSaved: () => void; setToast: (s: string) => void
}) {
  const nomeLead = lead.empresa || lead.nome || 'lead'
  const hoje = new Date()
  const dataDefault = lead.reuniao_agendada_em ? lead.reuniao_agendada_em.slice(0, 10)
    : `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
  const horaDefault = lead.reuniao_agendada_em ? new Date(lead.reuniao_agendada_em).toTimeString().slice(0, 5) : '09:00'
  const [titulo, setTitulo] = useState(`Reunião · ${nomeLead}`)
  const [data, setData] = useState(dataDefault)
  const [hIni, setHIni] = useState(horaDefault)
  const [hFim, setHFim] = useState(() => { const [h, m] = horaDefault.split(':').map((n) => parseInt(n, 10) || 0); return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}` })
  const [local, setLocal] = useState('')
  const [link, setLink] = useState('')
  const [obs, setObs] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const linkOk = !link.trim() || /^https?:\/\/.+/i.test(link.trim())

  async function salvar() {
    if (!data || !hIni) { setErro('Informe data e hora.'); return }
    if (!linkOk) { setErro('O link da reunião deve começar com http:// ou https://'); return }
    setBusy(true); setErro(null)
    const iso = new Date(`${data}T${hIni}`).toISOString()
    // marca a reunião no lead (+ etapa reuniao se existir no funil)
    await supabase.from('agency_leads').update({
      reuniao_agendada_em: iso, etapa: reuniaoChave ? reuniaoChave : lead.etapa, atualizado_em: new Date().toISOString(),
    }).eq('id', lead.id)
    // cria o evento na Agenda (comercial) com local + link (via dados → colunas)
    const { error } = await supabase.rpc('fn_agendamento_criar', {
      p_company_id: empresa, p_origem: 'comercial', p_titulo: titulo.trim() || `Reunião · ${nomeLead}`,
      p_cliente_id: lead.erp_cliente_id ?? null, p_cliente_nome: lead.empresa || lead.nome || null,
      p_responsavel_id: lead.responsavel_id ?? uid, p_responsavel_nome: null,
      p_data: data, p_hora_inicio: hIni, p_hora_fim: hFim || null,
      p_dados: { lead_id: lead.id, local: local.trim() || null, link_reuniao: link.trim() || null },
      p_observacao: obs.trim() || null,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    setToast('Reunião AGENDADA.'); onSaved()
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>📅 Agendar reunião</h2>
          <button onClick={onClose} style={btnSec}>Fechar</button>
        </div>
        <label style={lbl}>Título<input style={inp} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 10 }}>
          <label style={lbl}>Data<input type="date" style={inp} value={data} onChange={(e) => setData(e.target.value)} /></label>
          <label style={lbl}>Início<input type="time" style={inp} value={hIni} onChange={(e) => setHIni(e.target.value)} /></label>
          <label style={lbl}>Fim<input type="time" style={inp} value={hFim} onChange={(e) => setHFim(e.target.value)} /></label>
        </div>
        <label style={lbl}>Local (endereço, sala ou &quot;Online&quot;)<input style={inp} value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Online / Sala 2 / Rua X" /></label>
        <label style={lbl}>Link da reunião (Meet/Zoom/Teams — opcional)
          <input style={{ ...inp, borderColor: linkOk ? BORDA : RED }} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet.google.com/..." />
        </label>
        <label style={lbl}>Observação<input style={inp} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
        {erro && <div style={{ background: '#FCEBEB', color: RED, padding: '7px 10px', borderRadius: 6, fontSize: 12, marginTop: 8 }}>{erro}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>Cancelar</button>
          <button disabled={busy} onClick={() => void salvar()} style={btnPri}>{busy ? 'Salvando…' : 'Agendar'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Demanda 2 · Editar lead (update direto em agency_leads via RLS — RD-26, sem RPC nova) ─────────
function EditarLeadModal({ lead, empresa, origens, onClose, onSaved }: {
  lead: Lead; empresa: string; origens: Origem[]; onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState({
    empresa: lead.empresa ?? '', nome: lead.nome ?? '',
    contato_email: lead.contato_email ?? '', contato_telefone: lead.contato_telefone ?? '',
    origem: lead.origem ?? '', valor_estimado: lead.valor_estimado != null ? String(lead.valor_estimado) : '',
    observacoes: lead.observacoes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  async function salvar() {
    setBusy(true); setErro(null)
    const { error } = await supabase.from('agency_leads').update({
      empresa: f.empresa.trim() || null, nome: f.nome.trim() || null,
      contato_email: f.contato_email.trim() || null, contato_telefone: f.contato_telefone.trim() || null,
      origem: f.origem || lead.origem, valor_estimado: f.valor_estimado.trim() ? Number(f.valor_estimado) : null,
      observacoes: f.observacoes.trim() || null, atualizado_em: new Date().toISOString(),
    }).eq('id', lead.id).eq('company_id', empresa)
    setBusy(false)
    if (error) { setErro(error.message); return }
    onSaved()
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Editar lead</h2>
          <button onClick={onClose} style={btnSec}>Fechar</button>
        </div>
        <label style={lbl}>Empresa<input style={inp} value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} /></label>
        <label style={lbl}>Contato (nome)<input style={inp} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={lbl}>Email<input style={inp} value={f.contato_email} onChange={(e) => setF({ ...f, contato_email: e.target.value })} /></label>
          <label style={lbl}>Telefone<input style={inp} value={f.contato_telefone} onChange={(e) => setF({ ...f, contato_telefone: e.target.value })} /></label>
        </div>
        <label style={lbl}>Origem do Lead
          <select style={inp} value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })}>
            {!origens.some((o) => o.chave === f.origem) && f.origem && <option value={f.origem}>{f.origem}</option>}
            {origens.map((o) => <option key={o.chave} value={o.chave}>{o.nome}</option>)}
          </select>
        </label>
        <label style={lbl}>Valor Total Estimado do Contrato (R$)<input style={inp} type="number" inputMode="decimal" value={f.valor_estimado} onChange={(e) => setF({ ...f, valor_estimado: e.target.value })} /></label>
        <label style={lbl}>Observações<input style={inp} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></label>
        {erro && <div style={{ background: '#FCEBEB', color: RED, padding: '7px 10px', borderRadius: 6, fontSize: 12, marginTop: 8 }}>{erro}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>Cancelar</button>
          <button disabled={busy} onClick={() => void salvar()} style={btnPri}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

function Kpi({ l, v }: { l: string; v: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: ESPRESSO, marginTop: 2 }}>{v}</div>
    </div>
  )
}

const inp: CSSProperties = { border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40, background: '#fff', color: ESPRESSO, boxSizing: 'border-box' }
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: TEXTM, marginTop: 8 }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', minHeight: 42 }
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', minHeight: 36 }
const chip = (cor: string): CSSProperties => ({ border: `1px solid ${cor}`, color: cor, background: '#fff', borderRadius: 7, padding: '4px 7px', fontSize: 11, cursor: 'pointer', fontWeight: 600 })
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50, overflow: 'auto' }
const modal: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, marginTop: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
