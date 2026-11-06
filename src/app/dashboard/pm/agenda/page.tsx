'use client'

// Agenda Comercial (P&M) · Fase 1 — reusa erp_agendamento (origem_modulo='comercial'), RD-26.
// Visões dia/semana/mês lendo erp_agendamento (RLS por empresa). Criar/editar/status via
// fn_agendamento_criar / fn_agendamento_mudar_status. Vincula lead (agency_leads) em dados.lead_id.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', TEXTM = '#6b5444', GREEN = '#1F5A1F', RED = '#7A1F1F'
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const segDaSemana = (d: Date) => addDias(d, -((d.getDay() + 6) % 7))
const fmtDiaLabel = (s: string) => { const [y, m, dd] = s.split('-'); return `${dd}/${m}/${y}` }
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const STATUS_COR: Record<string, string> = { agendado: GOLD, confirmado: GREEN, em_atendimento: '#2F5AA8', concluido: '#166534', cancelado: RED, nao_compareceu: '#8A5A00' }
// Rótulo legível do status (RD-96): o cartão mostra um chip com o nome, não só a cor da borda.
const STATUS_LABEL: Record<string, string> = { agendado: 'Agendado', confirmado: 'Confirmado', em_atendimento: 'Em atendimento', concluido: 'Concluído', cancelado: 'Cancelado', nao_compareceu: 'Não compareceu' }
// fundo claro do chip derivado da cor do status (legível no design PS premium)
const STATUS_BG: Record<string, string> = { agendado: '#FBF0D8', confirmado: '#DCEFD7', em_atendimento: '#E1E9F6', concluido: '#D7EBDC', cancelado: '#F7DCDC', nao_compareceu: '#F3E6CC' }

type Ag = {
  id: string; titulo: string; data: string; hora_inicio: string | null; hora_fim: string | null
  status: string; cliente_nome: string | null; responsavel_id: string | null; responsavel_nome: string | null; observacao: string | null
  local: string | null; link_reuniao: string | null; dados: { lead_id?: string } | null
}
type LeadOpt = { id: string; nome: string; empresa: string | null; erp_cliente_id: string | null }
type MembroOpt = { user_id: string; nome: string }
type Vis = 'dia' | 'semana' | 'mes'

export default function AgendaComercialPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [vis, setVis] = useState<Vis>('semana')
  const [ref, setRef] = useState(new Date())
  // deep-link ?data=YYYY-MM-DD (ex.: clique "Ver na Agenda" no card do lead) → posiciona no dia do evento
  useEffect(() => {
    try {
      const d = new URLSearchParams(window.location.search).get('data')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) { setRef(new Date(`${d}T12:00:00`)); setVis('dia') }
    } catch { /* SSR/sem window */ }
  }, [])
  const [ags, setAgs] = useState<Ag[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  // #119/#98 Pdois (CEO 01/10): cada login vê a PRÓPRIA agenda (eventos e tarefas em que é o responsável, ou que criou sem
  // responsável); "Equipe" mostra a agenda de todos, como antes.
  const [quem, setQuem] = useState<'minha' | 'equipe'>('minha')
  const [nomeUsuario, setNomeUsuario] = useState<string | null>(null)
  const [modal, setModal] = useState<{ data: string; ag: Ag | null } | null>(null)
  const [leads, setLeads] = useState<LeadOpt[]>([])
  const [membros, setMembros] = useState<MembroOpt[]>([])

  const range = useMemo(() => {
    if (vis === 'dia') return { de: iso(ref), ate: iso(ref) }
    if (vis === 'semana') { const s = segDaSemana(ref); return { de: iso(s), ate: iso(addDias(s, 6)) } }
    const ini = new Date(ref.getFullYear(), ref.getMonth(), 1)
    const fim = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
    return { de: iso(ini), ate: iso(fim) }
  }, [vis, ref])

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true); setErro(null)
    if (quem === 'minha' && !uid) return
    let q = supabase.from('erp_agendamento')
      .select('id, titulo, data, hora_inicio, hora_fim, status, cliente_nome, responsavel_id, responsavel_nome, observacao, local, link_reuniao, dados')
      .eq('company_id', empresa).eq('origem_modulo', 'comercial')
      // defeito (Pdois · 01/10): evento excluído (soft delete) continuava aparecendo na agenda
      .is('excluido_em', null)
      .gte('data', range.de).lte('data', range.ate)
    if (quem === 'minha' && uid) q = q.or(`responsavel_id.eq.${uid},and(responsavel_id.is.null,created_by.eq.${uid})`)
    const { data, error } = await q.order('data').order('hora_inicio')
    setLoading(false)
    if (error) { setErro(error.message); return }
    setAgs((data as Ag[]) ?? [])
  }, [empresa, range.de, range.ate, quem, uid])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user; setUid(u?.id ?? null)
      if (!u) return
      // defeito (Pdois · 01/10): o card saía sem o nome do responsável — o evento era gravado com nome vazio
      const { data: urow } = await supabase.from('users').select('full_name').eq('id', u.id).maybeSingle()
      setNomeUsuario(((urow as { full_name?: string | null } | null)?.full_name || '').trim() || (u.email ?? null))
    })
  }, [])

  const carregarLeads = useCallback(async () => {
    if (!empresa) return
    const { data } = await supabase.from('agency_leads').select('id, nome, empresa, erp_cliente_id')
      .eq('company_id', empresa).order('criado_em', { ascending: false }).limit(200)
    setLeads((data as LeadOpt[]) ?? [])
    // equipe do P&M com login (user_id) — opções de responsável do evento (RD-98: responsável editável)
    const { data: eq } = await supabase.from('agency_equipe').select('user_id, nome')
      .eq('company_id', empresa).eq('ativo', true).not('user_id', 'is', null).order('nome')
    setMembros(((eq as MembroOpt[]) ?? []).filter((m) => m.user_id))
  }, [empresa])

  const porDia = useMemo(() => {
    const m = new Map<string, Ag[]>()
    for (const a of ags) { const arr = m.get(a.data) ?? []; arr.push(a); m.set(a.data, arr) }
    return m
  }, [ags])

  function abrirNovo(data: string) { void carregarLeads(); setModal({ data, ag: null }) }
  function abrirEditar(a: Ag) { void carregarLeads(); setModal({ data: a.data, ag: a }) }

  async function mudarStatus(a: Ag, status: string) {
    // #2244: p_motivo explícito — no banco há duas versões (2 e 3 args, a de 3 com DEFAULT) e a chamada
    // só com 2 parâmetros dava "could not choose the best candidate function". Motivo nulo = mesmo efeito.
    const { error } = await supabase.rpc('fn_agendamento_mudar_status', { p_id: a.id, p_status: status, p_motivo: null })
    if (error) { setErro(error.message); return }
    void carregar()
  }

  const tituloPeriodo = vis === 'dia' ? fmtDiaLabel(iso(ref))
    : vis === 'semana' ? `${fmtDiaLabel(range.de)} – ${fmtDiaLabel(range.ate)}`
    : `${MESES[ref.getMonth()]} ${ref.getFullYear()}`
  const passo = (n: number) => setRef((d) => vis === 'mes' ? new Date(d.getFullYear(), d.getMonth() + n, 1) : addDias(d, (vis === 'dia' ? 1 : 7) * n))

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: BG, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px,4vw,40px)', color: ESP }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>🗓️ P&amp;M · Comercial</div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Agenda</h1>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {(['minha', 'equipe'] as const).map((k) => (
              <button key={k} onClick={() => setQuem(k)} data-testid={`agenda-${k}`} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${quem === k ? ESP : LINE}`, background: quem === k ? ESP : '#fff', color: quem === k ? '#fff' : TEXTM }}>{k === 'minha' ? 'Minha agenda' : 'Equipe'}</button>
            ))}
            <AjudaCampo chave="pm.agenda.filtro_quem" />
            <span style={{ width: 8 }} />
            {(['dia', 'semana', 'mes'] as Vis[]).map((v) => (
              <button key={v} onClick={() => setVis(v)} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${vis === v ? GOLD : LINE}`, background: vis === v ? '#FBF3DE' : '#fff', color: vis === v ? '#8A5A0B' : TEXTM }}>{v === 'mes' ? 'mês' : v}</button>
            ))}
            <AjudaCampo chave="pm.agenda.filtro_periodo" />
            <button onClick={() => abrirNovo(iso(vis === 'mes' ? new Date() : ref))} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ Novo</button>
            <AjudaCampo chave="pm.agenda.novo_evento" alinhar="fim" />
          </div>
        </header>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button onClick={() => passo(-1)} style={navBtn}>←</button>
          <button onClick={() => setRef(new Date())} style={{ ...navBtn, width: 'auto', padding: '0 12px' }}>hoje</button>
          <button onClick={() => passo(1)} style={navBtn}>→</button>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{tituloPeriodo}</span>
        </div>

        {erro && <div style={{ background: '#FCEBEB', color: RED, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>{erro}</div>}
        {loading ? <div style={{ padding: 30, textAlign: 'center', color: TEXTM }}>Carregando…</div> : (
          <>
            {/* DIA */}
            {vis === 'dia' && <DiaCol data={iso(ref)} ags={porDia.get(iso(ref)) ?? []} onNovo={abrirNovo} onEditar={abrirEditar} onStatus={mudarStatus} destaque />}

            {/* SEMANA */}
            {vis === 'semana' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(150px,1fr))', gap: 10, overflowX: 'auto' }}>
                {Array.from({ length: 7 }, (_, i) => iso(addDias(segDaSemana(ref), i))).map((d, i) => (
                  <div key={d}>
                    <div style={{ fontSize: 11, color: TEXTM, fontWeight: 700, marginBottom: 4 }}>{DIAS[i]} · {d.slice(8)}/{d.slice(5, 7)}</div>
                    <DiaCol data={d} ags={porDia.get(d) ?? []} onNovo={abrirNovo} onEditar={abrirEditar} onStatus={mudarStatus} />
                  </div>
                ))}
              </div>
            )}

            {/* MÊS */}
            {vis === 'mes' && <MesGrid ref_={ref} porDia={porDia} onDia={(d) => { setRef(new Date(d)); setVis('dia') }} />}
          </>
        )}
      </div>

      {modal && empresa && (
        <EventoModal empresa={empresa} uid={uid} nomeUsuario={nomeUsuario} dataInicial={modal.data} ag={modal.ag} leads={leads} membros={membros}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); void carregar() }} />
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, cursor: 'pointer', fontSize: 14, fontWeight: 700 }

// agrupa os eventos do dia por horário de início (um cabeçalho por "slot"), para a semana não virar uma parede de
// cartões quase iguais (auditoria RD-96 31/10). "Sem horário" vai por último.
function agruparPorHora(ags: Ag[]): { hora: string; items: Ag[] }[] {
  const m = new Map<string, Ag[]>()
  for (const a of ags) { const h = a.hora_inicio ? a.hora_inicio.slice(0, 5) : 'Sem horário'; const arr = m.get(h) ?? []; arr.push(a); m.set(h, arr) }
  return [...m.entries()]
    .sort((x, y) => x[0] === 'Sem horário' ? 1 : y[0] === 'Sem horário' ? -1 : x[0].localeCompare(y[0]))
    .map(([hora, items]) => ({ hora, items }))
}

function DiaCol({ data, ags, onNovo, onEditar, onStatus, destaque }: {
  data: string; ags: Ag[]; onNovo: (d: string) => void; onEditar: (a: Ag) => void; onStatus: (a: Ag, s: string) => void; destaque?: boolean
}) {
  const slots = agruparPorHora(ags)
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 10, minHeight: destaque ? 200 : 96, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {ags.length === 0 ? (
        <button onClick={() => onNovo(data)} style={{ width: '100%', background: 'transparent', border: `1px dashed ${LINE}`, borderRadius: 10, padding: destaque ? 24 : 12, color: TEXTM, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>+ agendar</button>
      ) : (
        <>
          {slots.map((slot) => (
            <div key={slot.hora} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#8A5A0B', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                {slot.hora}{slot.items.length > 1 && <span style={{ color: TEXTM, fontWeight: 600, textTransform: 'none' }}> · {slot.items.length} eventos</span>}
              </div>
              {slot.items.map((a) => <EventoCard key={a.id} a={a} onEditar={onEditar} onStatus={onStatus} />)}
            </div>
          ))}
          <button onClick={() => onNovo(data)} style={{ background: 'transparent', border: `1px dashed ${LINE}`, color: '#8A5A0B', fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'center', borderRadius: 10, padding: '8px 10px', minHeight: 40 }}>+ agendar</button>
        </>
      )}
    </div>
  )
}

function EventoCard({ a, onEditar, onStatus }: { a: Ag; onEditar: (a: Ag) => void; onStatus: (a: Ag, s: string) => void }) {
  const cor = STATUS_COR[a.status] ?? GOLD
  const cancel = a.status === 'cancelado'
  return (
    <div style={{ border: `1px solid ${LINE}`, borderLeft: `4px solid ${cor}`, borderRadius: 10, padding: '10px 12px', background: cancel ? '#FBF1F1' : '#fff', display: 'flex', flexDirection: 'column', gap: 7, boxShadow: '0 1px 2px rgba(61,35,20,0.04)' }}>
      <button onClick={() => onEditar(a)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP, lineHeight: 1.25, textDecoration: cancel ? 'line-through' : 'none' }}>{a.titulo}</span>
          <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.3, background: STATUS_BG[a.status] ?? '#F0E9DE', color: cor }}>{STATUS_LABEL[a.status] ?? a.status}</span>
        </div>
        {(a.hora_inicio || a.hora_fim || a.local) && (
          <div style={{ fontSize: 11.5, color: TEXTM }}>{a.hora_inicio ? a.hora_inicio.slice(0, 5) : ''}{a.hora_fim ? `–${a.hora_fim.slice(0, 5)}` : ''}{a.local ? `${a.hora_inicio || a.hora_fim ? ' · ' : ''}${a.local}` : ''}</div>
        )}
        <div style={{ fontSize: 12, color: TEXTM }}>
          {a.cliente_nome ? <b style={{ color: ESP, fontWeight: 600 }}>{a.cliente_nome}</b> : <span style={{ fontStyle: 'italic' }}>Sem cliente</span>}
          {a.responsavel_nome ? <> · {a.responsavel_nome}</> : null}
        </div>
      </button>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {a.dados?.lead_id && <Link href="/dashboard/pm/leads" style={tagLink}>lead ↗</Link>}
        {a.link_reuniao && <a href={a.link_reuniao} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ ...tagLink, color: '#fff', background: '#2F5AA8', borderColor: '#2F5AA8' }}>▶ entrar</a>}
        {a.status !== 'confirmado' && a.status !== 'concluido' && a.status !== 'cancelado' && <button onClick={() => onStatus(a, 'confirmado')} style={miniBtn(GREEN)}>confirmar</button>}
        {a.status !== 'concluido' && a.status !== 'cancelado' && <button onClick={() => onStatus(a, 'concluido')} style={miniBtn('#166534')}>concluir</button>}
        {a.status !== 'cancelado' && <button onClick={() => onStatus(a, 'cancelado')} style={miniBtn(RED)}>cancelar</button>}
        <AjudaCampo chave="pm.agenda.cartao_status" />
      </div>
    </div>
  )
}
const miniBtn = (cor: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, color: cor, background: 'transparent', border: `1px solid ${cor}`, borderRadius: 7, padding: '3px 9px', cursor: 'pointer', minHeight: 30 })
const tagLink: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: '#2F5AA8', textDecoration: 'none', borderRadius: 7, padding: '3px 8px', border: `1px solid ${LINE}` }

function MesGrid({ ref_, porDia, onDia }: { ref_: Date; porDia: Map<string, Ag[]>; onDia: (d: string) => void }) {
  const ini = new Date(ref_.getFullYear(), ref_.getMonth(), 1)
  const start = segDaSemana(ini)
  const dias = Array.from({ length: 42 }, (_, i) => addDias(start, i))
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, fontSize: 10.5, color: TEXTM, fontWeight: 700, marginBottom: 4 }}>
        {DIAS.map((d) => <div key={d} style={{ textAlign: 'center' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {dias.map((d) => {
          const k = iso(d); const evs = porDia.get(k) ?? []; const noMes = d.getMonth() === ref_.getMonth()
          return (
            <button key={k} onClick={() => onDia(k)} style={{ textAlign: 'left', minHeight: 72, background: noMes ? '#fff' : '#F6F2EA', border: `1px solid ${LINE}`, borderRadius: 8, padding: 6, cursor: 'pointer', opacity: noMes ? 1 : 0.6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: ESP }}>{d.getDate()}</div>
              {evs.slice(0, 2).map((a) => (
                <div key={a.id} style={{ fontSize: 9.5, color: TEXTM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color: STATUS_COR[a.status] ?? GOLD }}>●</span> {a.hora_inicio ? a.hora_inicio.slice(0, 5) + ' ' : ''}{a.titulo}
                </div>
              ))}
              {evs.length > 2 && <div style={{ fontSize: 9.5, color: GOLD, fontWeight: 700 }}>+{evs.length - 2}</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function EventoModal({ empresa, uid, nomeUsuario, dataInicial, ag, leads, membros, onClose, onSaved }: {
  empresa: string; uid: string | null; nomeUsuario: string | null; dataInicial: string; ag: Ag | null; leads: LeadOpt[]; membros: MembroOpt[]; onClose: () => void; onSaved: () => void
}) {
  const [titulo, setTitulo] = useState(ag?.titulo ?? '')
  const [data, setData] = useState(ag?.data ?? dataInicial)
  const [hIni, setHIni] = useState(ag?.hora_inicio?.slice(0, 5) ?? '09:00')
  const [hFim, setHFim] = useState(ag?.hora_fim?.slice(0, 5) ?? '10:00')
  const [obs, setObs] = useState(ag?.observacao ?? '')
  const [leadId, setLeadId] = useState(ag?.dados?.lead_id ?? '')
  const [local, setLocal] = useState(ag?.local ?? '')
  const [link, setLink] = useState(ag?.link_reuniao ?? '')
  // responsável editável (RD-98): novo evento assume quem está logado; evento existente abre no responsável atual.
  const [responsavelId, setResponsavelId] = useState(ag?.responsavel_id ?? uid ?? '')
  // lista de opções: a equipe com login + (garante) o responsável atual e o próprio usuário, mesmo que não estejam na equipe
  const opcoesResp: MembroOpt[] = (() => {
    const map = new Map<string, MembroOpt>()
    for (const m of membros) map.set(m.user_id, m)
    if (uid && !map.has(uid)) map.set(uid, { user_id: uid, nome: nomeUsuario || 'Eu' })
    if (ag?.responsavel_id && !map.has(ag.responsavel_id)) map.set(ag.responsavel_id, { user_id: ag.responsavel_id, nome: ag.responsavel_nome || 'Responsável atual' })
    return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome))
  })()
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const router = useRouter()
  const linkOk = !link.trim() || /^https?:\/\/.+/i.test(link.trim())

  async function salvar() {
    if (!titulo.trim()) { setErro('Informe o título.'); return }
    if (!linkOk) { setErro('O link deve começar com http:// ou https://'); return }
    setBusy(true); setErro(null)
    const lead = leads.find((l) => l.id === leadId)
    const resp = opcoesResp.find((m) => m.user_id === responsavelId)
    const respNome = resp?.nome ?? (responsavelId && responsavelId === uid ? nomeUsuario : null)
    // defeito (Pdois · 01/10): salvar um evento EXISTENTE criava outro (sempre chamava o criar). Agora atualiza o
    // próprio evento (RLS da agenda limita à empresa do usuário); o vínculo com o lead vai em dados.lead_id.
    if (ag) {
      const dados = { ...(ag.dados ?? {}), lead_id: leadId || null, local: local.trim() || null, link_reuniao: link.trim() || null }
      const { error } = await supabase.from('erp_agendamento').update({
        titulo: titulo.trim(), data, hora_inicio: hIni || null, hora_fim: hFim || null, observacao: obs.trim() || null,
        local: local.trim() || null, link_reuniao: link.trim() || null, dados,
        responsavel_id: responsavelId || null, responsavel_nome: respNome,
        ...(lead ? { cliente_id: lead.erp_cliente_id ?? null, cliente_nome: lead.empresa || lead.nome } : {}),
      }).eq('id', ag.id).eq('company_id', empresa)
      setBusy(false)
      if (error) { setErro(error.message); return }
      onSaved(); return
    }
    const { error } = await supabase.rpc('fn_agendamento_criar', {
      p_company_id: empresa, p_origem: 'comercial', p_titulo: titulo.trim(),
      p_cliente_id: lead?.erp_cliente_id ?? null, p_cliente_nome: lead ? (lead.empresa || lead.nome) : null,
      p_responsavel_id: responsavelId || uid, p_responsavel_nome: respNome ?? nomeUsuario,
      p_data: data, p_hora_inicio: hIni || null, p_hora_fim: hFim || null,
      p_dados: { ...(leadId ? { lead_id: leadId } : {}), local: local.trim() || null, link_reuniao: link.trim() || null },
      p_observacao: obs.trim() || null,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    onSaved()
  }

  // RD-98 pilar 4 · exclusão RASTREÁVEL exposta na tela: soft-delete por fn_agendamento_excluir (marca
  // excluido_em/excluido_por/excluido_motivo; a listagem já filtra excluido_em IS NULL). Reversível pela auditoria.
  async function excluir() {
    if (!ag) return
    if (!window.confirm('Excluir este evento da agenda? Ele sai da lista (exclusão rastreável: guarda quem excluiu e quando, e pode ser revertida pela auditoria). Confirmar?')) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_agendamento_excluir', { p_id: ag.id, p_motivo: null })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) {
      setErro(error?.message
        ?? (r?.erro === 'ja_virou_os' ? 'Este evento já virou uma Ordem de Serviço — não pode ser excluído pela agenda; trate pela OS.'
          : r?.erro === 'sem_acesso' ? 'Você não tem acesso a este evento.'
          : r?.erro === 'agendamento_nao_encontrado' ? 'Evento não encontrado (pode já ter sido excluído).'
          : r?.erro ?? 'Não foi possível excluir o evento.'))
      return
    }
    onSaved()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 14px', zIndex: 60, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 12, width: '100%', maxWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '12px 12px 0 0' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>{ag ? 'Evento' : 'Novo evento'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: BG, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ag && (
            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, color: TEXTM }}>
                {ag.cliente_nome ? <><b>{ag.cliente_nome}</b> · </> : null}{ag.hora_inicio?.slice(0, 5) ?? ''}{ag.hora_fim ? `–${ag.hora_fim.slice(0, 5)}` : ''}{ag.local ? ` · ${ag.local}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ag.dados?.lead_id && (
                  <button onClick={() => router.push('/dashboard/pm/leads')} style={{ background: '#2F5AA8', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>🔗 Abrir card do lead</button>
                )}
                {ag.link_reuniao && (
                  <a href={ag.link_reuniao} target="_blank" rel="noopener noreferrer" style={{ background: '#166534', color: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>▶ Entrar na reunião</a>
                )}
              </div>
              <div style={{ fontSize: 10.5, color: TEXTM }}>Altere os campos abaixo e salve para reagendar este mesmo evento.</div>
            </div>
          )}
          <label style={lbl}><span style={rot}>Título<AjudaCampo chave="pm.agenda.evento_titulo" /></span><input value={titulo} onChange={(e) => setTitulo(e.target.value)} style={inp} placeholder="Ex.: Reunião com cliente" /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <label style={lbl}><span style={rot}>Data<AjudaCampo chave="pm.agenda.evento_data" /></span><input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inp} /></label>
            <label style={lbl}><span style={rot}>Início<AjudaCampo chave="pm.agenda.evento_inicio" /></span><input type="time" value={hIni} onChange={(e) => setHIni(e.target.value)} style={inp} /></label>
            <label style={lbl}><span style={rot}>Fim<AjudaCampo chave="pm.agenda.evento_fim" /></span><input type="time" value={hFim} onChange={(e) => setHFim(e.target.value)} style={inp} /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={lbl}><span style={rot}>Vincular lead (opcional)<AjudaCampo chave="pm.agenda.evento_lead" /></span>
              <select value={leadId} onChange={(e) => setLeadId(e.target.value)} style={inp}>
                <option value="">— sem lead —</option>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.empresa || l.nome}</option>)}
              </select>
            </label>
            <label style={lbl}><span style={rot}>Responsável<AjudaCampo chave="pm.job.responsavel" /></span>
              <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} style={inp} data-testid="agenda-evento-responsavel">
                <option value="">— sem responsável —</option>
                {opcoesResp.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
              </select>
            </label>
          </div>
          <label style={lbl}><span style={rot}>Local (endereço, sala ou &quot;Online&quot;)<AjudaCampo chave="pm.agenda.evento_local" /></span><input value={local} onChange={(e) => setLocal(e.target.value)} style={inp} placeholder="Online / Sala 2 / Rua X" /></label>
          <label style={lbl}><span style={rot}>Link da reunião (Meet/Zoom — opcional)<AjudaCampo chave="pm.agenda.evento_link" /></span><input value={link} onChange={(e) => setLink(e.target.value)} style={{ ...inp, borderColor: linkOk ? LINE : RED }} placeholder="https://meet.google.com/..." /></label>
          <label style={lbl}><span style={rot}>Observação<AjudaCampo chave="pm.agenda.evento_obs" /></span><input value={obs} onChange={(e) => setObs(e.target.value)} style={inp} /></label>
          {erro && <div style={{ background: '#FCEBEB', color: RED, padding: '7px 10px', borderRadius: 6, fontSize: 12 }}>{erro}</div>}
          <div style={{ display: 'flex', justifyContent: ag ? 'space-between' : 'flex-end', gap: 8, alignItems: 'center' }}>
            {ag && (
              <span style={rot}>
                <button onClick={() => void excluir()} disabled={busy} data-testid="agenda-evento-excluir" style={{ background: 'transparent', color: RED, border: `1px solid ${RED}`, padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>🗑️ Excluir</button>
                <AjudaCampo chave="pm.agenda.evento_excluir" />
              </span>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ background: 'transparent', color: ESP, border: `1px solid ${LINE}`, padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => void salvar()} disabled={busy} style={{ background: GOLD, color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{busy ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
const lbl: React.CSSProperties = { fontSize: 11, color: TEXTM, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 4 }
const rot: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 }
const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: ESP, background: '#fff', fontFamily: 'inherit' }
