'use client'
// LEADS · CRM de entrada da agência (P&M). Funil sobre agency_leads, escopado por company_id (RD-45).
// Cadastro rápido com autocomplete de clientes da GE (fn_cliente_buscar) + criar cliente inline
// (fn_cliente_criar_inline) + kanban por etapa (arrasta) + ações Ganhar/Perder/Converter/Agendar.
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

const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const ORIGENS: { v: string; l: string }[] = [
  { v: 'prospeccao_ia_fria', l: 'Prospecção IA (fria)' },
  { v: 'indicacao', l: 'Indicação' },
  { v: 'trafego_pago', l: 'Tráfego pago' },
  { v: 'relacionamento', l: 'Relacionamento' },
]
const ETAPAS: { v: string; l: string; cor: string }[] = [
  { v: 'novo', l: 'Novo', cor: '#F0E9DE' },
  { v: 'atendimento', l: 'Atendimento', cor: '#FFF3D6' },
  { v: 'reuniao_agendada', l: 'Reunião', cor: '#FCE9C2' },
  { v: 'entendimento', l: 'Entendimento', cor: '#FAD18A' },
  { v: 'proposta', l: 'Proposta', cor: '#F4B860' },
  { v: 'negociacao', l: 'Negociação', cor: '#E8A93A' },
  { v: 'ganho', l: 'Ganho', cor: '#DCEFD7' },
  { v: 'perdido', l: 'Perdido', cor: '#F4D6D6' },
]
const etapaCfg = (v: string) => ETAPAS.find((e) => e.v === v) ?? { v, l: v, cor: OFFWHITE }
const origemL = (v: string) => ORIGENS.find((o) => o.v === v)?.l ?? v

type Lead = {
  id: string; company_id: string; nome: string; empresa: string | null
  origem: string; canal_contato: string | null; etapa: string
  reuniao_agendada_em: string | null; valor_estimado: number | null
  responsavel_id: string | null; cliente_id: string | null
  contato_email: string | null; contato_telefone: string | null
  motivo_perda: string | null; observacoes: string | null; criado_em: string
}
type FormLead = {
  empresa: string; nome: string; contato_email: string; contato_telefone: string
  canal_contato: string; origem: string; valor_estimado: string; cliente_id: string | null
}
const FORM0: FormLead = { empresa: '', nome: '', contato_email: '', contato_telefone: '', canal_contato: 'whatsapp', origem: 'trafego_pago', valor_estimado: '', cliente_id: null }

export default function LeadsPage() {
  const router = useRouter()
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [respMap, setRespMap] = useState<Record<string, string>>({})
  const [uid, setUid] = useState<string | null>(null)
  // filtros
  const [fOrigem, setFOrigem] = useState('todas')
  const [fCanal, setFCanal] = useState('todos')
  const [fResp, setFResp] = useState('todos')
  const [busca, setBusca] = useState('')
  // modal + cadastro rápido
  const [novo, setNovo] = useState(false)
  const [form, setForm] = useState<FormLead>(FORM0)
  const [cliTermo, setCliTermo] = useState('')
  const [cliSug, setCliSug] = useState<{ id: string; nome: string; doc: string | null }[]>([])
  const [cliBuscando, setCliBuscando] = useState(false)
  const cliTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setLeads([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('agency_leads').select('*').eq('company_id', empresa).order('criado_em', { ascending: false })
    const rows = (data ?? []) as Lead[]
    setLeads(rows)
    const ids = Array.from(new Set(rows.map((r) => r.responsavel_id).filter(Boolean))) as string[]
    if (ids.length) {
      const { data: us } = await supabase.from('users').select('id, full_name, email').in('id', ids)
      const m: Record<string, string> = {}
      for (const u of (us ?? []) as { id: string; full_name: string | null; email: string | null }[]) m[u.id] = u.full_name || u.email || '—'
      setRespMap(m)
    } else setRespMap({})
    setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null)) }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])

  const canais = useMemo(() => Array.from(new Set(leads.map((l) => l.canal_contato).filter(Boolean))) as string[], [leads])
  const responsaveis = useMemo(() => Array.from(new Set(leads.map((l) => l.responsavel_id).filter(Boolean))) as string[], [leads])
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return leads.filter((l) =>
      (fOrigem === 'todas' || l.origem === fOrigem) &&
      (fCanal === 'todos' || l.canal_contato === fCanal) &&
      (fResp === 'todos' || l.responsavel_id === fResp) &&
      (!q || [l.nome, l.empresa, l.contato_email, l.contato_telefone].some((x) => (x ?? '').toLowerCase().includes(q))))
  }, [leads, fOrigem, fCanal, fResp, busca])
  const kpis = useMemo(() => ({
    total: leads.length,
    emAberto: leads.filter((l) => !['ganho', 'perdido'].includes(l.etapa)).length,
    ganhos: leads.filter((l) => l.etapa === 'ganho').length,
    pipeline: leads.filter((l) => !['ganho', 'perdido'].includes(l.etapa)).reduce((s, l) => s + Number(l.valor_estimado ?? 0), 0),
  }), [leads])

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
    setCliTermo(v); setForm((f) => ({ ...f, empresa: v, cliente_id: null }))
    if (cliTimer.current) clearTimeout(cliTimer.current)
    cliTimer.current = setTimeout(() => void buscarClientes(v), 250)
  }
  async function escolherCliente(c: { id: string; nome: string }) {
    setCliSug([]); setCliTermo(c.nome)
    // prefill contato do cadastro GE
    const { data } = await supabase.from('erp_clientes').select('email, telefone, celular, whatsapp').eq('id', c.id).maybeSingle()
    const d = (data ?? {}) as { email?: string | null; telefone?: string | null; celular?: string | null; whatsapp?: string | null }
    setForm((f) => ({ ...f, empresa: c.nome, cliente_id: c.id, contato_email: d.email ?? f.contato_email, contato_telefone: d.telefone || d.celular || d.whatsapp || f.contato_telefone }))
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
      setForm((f) => ({ ...f, empresa: nome, cliente_id: cid })); setCliSug([]); setCliTermo(nome)
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
        valor_estimado: form.valor_estimado || null, cliente_id: form.cliente_id, responsavel_id: uid,
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
    setToast(`Movido para ${etapaCfg(etapa).l}.`)
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
    await supabase.from('agency_leads').update({ etapa: 'perdido', motivo_perda: motivo.trim(), atualizado_em: new Date().toISOString() }).eq('id', l.id)
    setToast('Marcado como PERDIDO.'); void carregar()
  }
  // Converter em cliente: liga (ou cria) um erp_cliente ao lead e leva pra Propostas.
  // Obs.: fn_crm_converter_lead opera em erp_crm_lead (outra tabela) — aqui o vínculo é nativo do agency_leads.
  async function converter(l: Lead) {
    if (!empresa) return
    setBusy(true)
    try {
      let cid = l.cliente_id
      if (!cid) {
        const nome = (l.empresa || l.nome || '').trim()
        if (!nome) { setToast('Lead sem empresa/contato para criar cliente.'); return }
        const { data, error } = await supabase.rpc('fn_cliente_criar_inline', { p_company_id: empresa, p_nome: nome, p_cpf_cnpj: null, p_extra: { email: l.contato_email || null, telefone: l.contato_telefone || null } })
        if (error) { setToast(`Erro: ${error.message}`); return }
        cid = data as string | null
        if (cid) await supabase.from('agency_leads').update({ cliente_id: cid, atualizado_em: new Date().toISOString() }).eq('id', l.id)
      }
      setToast('Cliente ligado ao lead → Propostas.'); void carregar()
      setTimeout(() => router.push('/dashboard/pm/propostas'), 700)
    } finally { setBusy(false) }
  }
  async function agendar(l: Lead) {
    const atual = l.reuniao_agendada_em ? l.reuniao_agendada_em.slice(0, 16) : ''
    const val = prompt('Data/hora da reunião (AAAA-MM-DDThh:mm):', atual)
    if (val === null) return
    const iso = val.trim() ? new Date(val.trim()).toISOString() : null
    if (val.trim() && iso && isNaN(new Date(val.trim()).getTime())) { setToast('Data inválida.'); return }
    await supabase.from('agency_leads').update({ reuniao_agendada_em: iso, etapa: iso ? 'reuniao_agendada' : l.etapa, atualizado_em: new Date().toISOString() }).eq('id', l.id)
    setToast(iso ? 'Reunião AGENDADA.' : 'Agendamento removido.'); void carregar()
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
          <button onClick={() => { setForm(FORM0); setCliTermo(''); setCliSug([]); setNovo(true) }} style={btnPri} data-testid="lead-novo">+ Novo lead</button>
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
            {ORIGENS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select value={fCanal} onChange={(e) => setFCanal(e.target.value)} style={inp} aria-label="Canal">
            <option value="todos">Canal: todos</option>
            {canais.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={fResp} onChange={(e) => setFResp(e.target.value)} style={inp} aria-label="Responsável">
            <option value="todos">Responsável: todos</option>
            {responsaveis.map((r) => <option key={r} value={r}>{respMap[r] ?? '—'}</option>)}
          </select>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div> : (
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
            {ETAPAS.map((col) => {
              const items = filtrados.filter((l) => l.etapa === col.v)
              const soma = items.reduce((s, l) => s + Number(l.valor_estimado ?? 0), 0)
              return (
                <div key={col.v}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { const l = leads.find((x) => x.id === dragId); if (l) void moverEtapa(l, col.v); setDragId(null) }}
                  style={{ minWidth: 250, width: 250, flex: '0 0 auto', background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 8px' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: col.cor, border: `1px solid ${BORDA}` }} />
                    <strong style={{ fontSize: 13 }}>{col.l}</strong>
                    <span style={{ fontSize: 11, color: TEXTM, marginLeft: 'auto' }}>{items.length}{soma > 0 ? ` · ${brl(soma)}` : ''}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 20 }}>
                    {items.map((l) => {
                      const fim = ['ganho', 'perdido'].includes(l.etapa)
                      return (
                        <div key={l.id} draggable onDragStart={() => setDragId(l.id)} onDragEnd={() => setDragId(null)}
                          data-testid="lead-card"
                          style={{ background: OFFWHITE, border: `1px solid ${BORDA}`, borderRadius: 10, padding: '9px 10px', cursor: 'grab' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <strong style={{ fontSize: 13 }}>{l.empresa || l.nome}</strong>
                            {l.cliente_id && <span title="Cliente cadastrado na GE" style={{ fontSize: 9.5, fontWeight: 700, color: GREEN, background: '#DCEFD7', borderRadius: 999, padding: '1px 6px' }}>✓ cliente</span>}
                          </div>
                          {l.empresa && l.nome && l.nome !== l.empresa && <div style={{ fontSize: 11.5, color: TEXTM }}>{l.nome}</div>}
                          <div style={{ fontSize: 11, color: TEXTM, marginTop: 3 }}>
                            {origemL(l.origem)}{l.canal_contato ? ` · ${l.canal_contato}` : ''}{l.valor_estimado ? ` · ${brl(Number(l.valor_estimado))}` : ''}
                          </div>
                          {(l.contato_email || l.contato_telefone) && <div style={{ fontSize: 10.5, color: TEXTM, marginTop: 2 }}>{[l.contato_telefone, l.contato_email].filter(Boolean).join(' · ')}</div>}
                          {l.responsavel_id && respMap[l.responsavel_id] && <div style={{ fontSize: 10.5, color: TEXTM, marginTop: 2 }}>resp: {respMap[l.responsavel_id]}</div>}
                          {l.reuniao_agendada_em && <div style={{ fontSize: 10.5, color: DOURADO, marginTop: 2 }}>📅 {new Date(l.reuniao_agendada_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
                          {l.etapa === 'perdido' && l.motivo_perda && <div style={{ fontSize: 10.5, color: RED, marginTop: 2 }}>motivo: {l.motivo_perda}</div>}
                          {!fim && (
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
                              <button disabled={busy} onClick={() => ganhar(l)} style={chip(GREEN)}>✓ Ganhar</button>
                              <button onClick={() => perder(l)} style={chip(RED)}>✕ Perder</button>
                              <button disabled={busy} onClick={() => converter(l)} style={chip(ESPRESSO)}>→ Converter</button>
                              <button onClick={() => agendar(l)} style={chip(DOURADO)}>📅 Reunião</button>
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
                {(cliSug.length > 0 || cliBuscando || (cliTermo.trim().length >= 2 && !form.cliente_id)) && (
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
            {form.cliente_id && <div style={{ fontSize: 11, color: GREEN, marginTop: 4 }}>✓ vinculado a um cliente cadastrado</div>}

            <label style={lbl}>Contato (nome)<input style={inp} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Pessoa de contato" /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={lbl}>Email<input style={inp} value={form.contato_email} onChange={(e) => setForm({ ...form, contato_email: e.target.value })} /></label>
              <label style={lbl}>Telefone<input style={inp} value={form.contato_telefone} onChange={(e) => setForm({ ...form, contato_telefone: e.target.value })} /></label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={lbl}>Canal
                <select style={inp} value={form.canal_contato} onChange={(e) => setForm({ ...form, canal_contato: e.target.value })}>
                  {['whatsapp', 'site', 'indicacao', 'trafego_pago', 'ligacao', 'email', 'evento'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={lbl}>Origem
                <select style={inp} value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })}>
                  {ORIGENS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </label>
            </div>
            <label style={lbl}>Valor estimado (R$)<input style={inp} type="number" inputMode="decimal" value={form.valor_estimado} onChange={(e) => setForm({ ...form, valor_estimado: e.target.value })} /></label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setNovo(false)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={criar} style={btnPri} data-testid="lead-salvar">{busy ? 'Salvando…' : 'CRIAR'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
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
const chip = (cor: string): CSSProperties => ({ border: `1px solid ${cor}`, color: cor, background: '#fff', borderRadius: 7, padding: '4px 7px', fontSize: 11, cursor: 'pointer', fontWeight: 600 })
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50, overflow: 'auto' }
const modal: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, marginTop: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
