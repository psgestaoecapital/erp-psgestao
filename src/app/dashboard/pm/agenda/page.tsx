'use client'

// Agenda Comercial (P&M) · Fase 1 — reusa erp_agendamento (origem_modulo='comercial'), RD-26.
// Visões dia/semana/mês lendo erp_agendamento (RLS por empresa). Criar/editar/status via
// fn_agendamento_criar / fn_agendamento_mudar_status. Vincula lead (agency_leads) em dados.lead_id.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', TEXTM = '#6b5444', GREEN = '#1F5A1F', RED = '#7A1F1F'
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const segDaSemana = (d: Date) => addDias(d, -((d.getDay() + 6) % 7))
const fmtDiaLabel = (s: string) => { const [y, m, dd] = s.split('-'); return `${dd}/${m}/${y}` }
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const STATUS_COR: Record<string, string> = { agendado: GOLD, confirmado: GREEN, em_atendimento: '#2F5AA8', concluido: '#166534', cancelado: RED, nao_compareceu: '#8A5A00' }

type Ag = {
  id: string; titulo: string; data: string; hora_inicio: string | null; hora_fim: string | null
  status: string; cliente_nome: string | null; responsavel_nome: string | null; observacao: string | null
  dados: { lead_id?: string } | null
}
type LeadOpt = { id: string; nome: string; empresa: string | null; erp_cliente_id: string | null }
type Vis = 'dia' | 'semana' | 'mes'

export default function AgendaComercialPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [vis, setVis] = useState<Vis>('semana')
  const [ref, setRef] = useState(new Date())
  const [ags, setAgs] = useState<Ag[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [modal, setModal] = useState<{ data: string; ag: Ag | null } | null>(null)
  const [leads, setLeads] = useState<LeadOpt[]>([])

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
    const { data, error } = await supabase.from('erp_agendamento')
      .select('id, titulo, data, hora_inicio, hora_fim, status, cliente_nome, responsavel_nome, observacao, dados')
      .eq('company_id', empresa).eq('origem_modulo', 'comercial')
      .gte('data', range.de).lte('data', range.ate).order('data').order('hora_inicio')
    setLoading(false)
    if (error) { setErro(error.message); return }
    setAgs((data as Ag[]) ?? [])
  }, [empresa, range.de, range.ate])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null)) }, [])

  const carregarLeads = useCallback(async () => {
    if (!empresa) return
    const { data } = await supabase.from('agency_leads').select('id, nome, empresa, erp_cliente_id')
      .eq('company_id', empresa).order('criado_em', { ascending: false }).limit(200)
    setLeads((data as LeadOpt[]) ?? [])
  }, [empresa])

  const porDia = useMemo(() => {
    const m = new Map<string, Ag[]>()
    for (const a of ags) { const arr = m.get(a.data) ?? []; arr.push(a); m.set(a.data, arr) }
    return m
  }, [ags])

  function abrirNovo(data: string) { void carregarLeads(); setModal({ data, ag: null }) }
  function abrirEditar(a: Ag) { void carregarLeads(); setModal({ data: a.data, ag: a }) }

  async function mudarStatus(a: Ag, status: string) {
    const { error } = await supabase.rpc('fn_agendamento_mudar_status', { p_id: a.id, p_status: status })
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
            {(['dia', 'semana', 'mes'] as Vis[]).map((v) => (
              <button key={v} onClick={() => setVis(v)} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${vis === v ? GOLD : LINE}`, background: vis === v ? '#FBF3DE' : '#fff', color: vis === v ? '#8A5A0B' : TEXTM }}>{v === 'mes' ? 'mês' : v}</button>
            ))}
            <button onClick={() => abrirNovo(iso(vis === 'mes' ? new Date() : ref))} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ Novo</button>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(120px,1fr))', gap: 8, overflowX: 'auto' }}>
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
        <EventoModal empresa={empresa} uid={uid} dataInicial={modal.data} ag={modal.ag} leads={leads}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); void carregar() }} />
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, cursor: 'pointer', fontSize: 14, fontWeight: 700 }

function DiaCol({ data, ags, onNovo, onEditar, onStatus, destaque }: {
  data: string; ags: Ag[]; onNovo: (d: string) => void; onEditar: (a: Ag) => void; onStatus: (a: Ag, s: string) => void; destaque?: boolean
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 8, minHeight: destaque ? 200 : 90 }}>
      {ags.length === 0 ? (
        <button onClick={() => onNovo(data)} style={{ width: '100%', background: 'transparent', border: `1px dashed ${LINE}`, borderRadius: 8, padding: destaque ? 20 : 8, color: TEXTM, fontSize: 11.5, cursor: 'pointer' }}>+ agendar</button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ags.map((a) => (
            <div key={a.id} style={{ border: `1px solid ${LINE}`, borderLeft: `3px solid ${STATUS_COR[a.status] ?? GOLD}`, borderRadius: 6, padding: '6px 8px', background: a.status === 'cancelado' ? '#FBF1F1' : '#FFFDF8' }}>
              <button onClick={() => onEditar(a)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', width: '100%' }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: ESP, textDecoration: a.status === 'cancelado' ? 'line-through' : 'none' }}>
                  {a.hora_inicio ? a.hora_inicio.slice(0, 5) + ' ' : ''}{a.titulo}
                </div>
                <div style={{ fontSize: 10.5, color: TEXTM }}>{a.cliente_nome ?? ''}{a.responsavel_nome ? ` · ${a.responsavel_nome}` : ''}</div>
              </button>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {a.dados?.lead_id && <Link href="/dashboard/pm/leads" style={{ fontSize: 9.5, color: '#2F5AA8', textDecoration: 'none', fontWeight: 700 }}>lead ↗</Link>}
                {a.status !== 'confirmado' && a.status !== 'concluido' && a.status !== 'cancelado' && <button onClick={() => onStatus(a, 'confirmado')} style={miniBtn(GREEN)}>confirmar</button>}
                {a.status !== 'concluido' && a.status !== 'cancelado' && <button onClick={() => onStatus(a, 'concluido')} style={miniBtn('#166534')}>concluir</button>}
                {a.status !== 'cancelado' && <button onClick={() => onStatus(a, 'cancelado')} style={miniBtn(RED)}>cancelar</button>}
              </div>
            </div>
          ))}
          <button onClick={() => onNovo(data)} style={{ background: 'transparent', border: 'none', color: GOLD, fontSize: 11, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>+ agendar</button>
        </div>
      )}
    </div>
  )
}
const miniBtn = (cor: string): React.CSSProperties => ({ fontSize: 9.5, fontWeight: 700, color: cor, background: 'transparent', border: `0.5px solid ${cor}`, borderRadius: 4, padding: '1px 5px', cursor: 'pointer' })

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

function EventoModal({ empresa, uid, dataInicial, ag, leads, onClose, onSaved }: {
  empresa: string; uid: string | null; dataInicial: string; ag: Ag | null; leads: LeadOpt[]; onClose: () => void; onSaved: () => void
}) {
  const [titulo, setTitulo] = useState(ag?.titulo ?? '')
  const [data, setData] = useState(ag?.data ?? dataInicial)
  const [hIni, setHIni] = useState(ag?.hora_inicio?.slice(0, 5) ?? '09:00')
  const [hFim, setHFim] = useState(ag?.hora_fim?.slice(0, 5) ?? '10:00')
  const [obs, setObs] = useState(ag?.observacao ?? '')
  const [leadId, setLeadId] = useState(ag?.dados?.lead_id ?? '')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!titulo.trim()) { setErro('Informe o título.'); return }
    setBusy(true); setErro(null)
    const lead = leads.find((l) => l.id === leadId)
    // Fase 1: editar reusa o mesmo criar? Não há fn_editar — para edição, mudamos só o status via RPC.
    // Criar novo agendamento (o fluxo de edição completa fica pra refinamento; aqui o Novo é o caminho).
    const { error } = await supabase.rpc('fn_agendamento_criar', {
      p_company_id: empresa, p_origem: 'comercial', p_titulo: titulo.trim(),
      p_cliente_id: lead?.erp_cliente_id ?? null, p_cliente_nome: lead ? (lead.empresa || lead.nome) : null,
      p_responsavel_id: uid, p_responsavel_nome: null,
      p_data: data, p_hora_inicio: hIni || null, p_hora_fim: hFim || null,
      p_dados: leadId ? { lead_id: leadId } : {}, p_observacao: obs.trim() || null,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
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
          {ag && <div style={{ fontSize: 11.5, color: TEXTM }}>Para reagendar/alterar este evento, crie um novo ou mude o status na agenda. (Edição completa vem no refinamento.)</div>}
          <label style={lbl}>Título<input value={titulo} onChange={(e) => setTitulo(e.target.value)} style={inp} placeholder="Ex.: Reunião com cliente" /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <label style={lbl}>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inp} /></label>
            <label style={lbl}>Início<input type="time" value={hIni} onChange={(e) => setHIni(e.target.value)} style={inp} /></label>
            <label style={lbl}>Fim<input type="time" value={hFim} onChange={(e) => setHFim(e.target.value)} style={inp} /></label>
          </div>
          <label style={lbl}>Vincular lead (opcional)
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)} style={inp}>
              <option value="">— sem lead —</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.empresa || l.nome}</option>)}
            </select>
          </label>
          <label style={lbl}>Observação<input value={obs} onChange={(e) => setObs(e.target.value)} style={inp} /></label>
          {erro && <div style={{ background: '#FCEBEB', color: RED, padding: '7px 10px', borderRadius: 6, fontSize: 12 }}>{erro}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} style={{ background: 'transparent', color: ESP, border: `1px solid ${LINE}`, padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
            <button onClick={() => void salvar()} disabled={busy} style={{ background: GOLD, color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{busy ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
const lbl: React.CSSProperties = { fontSize: 11, color: TEXTM, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 4 }
const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: ESP, background: '#fff', fontFamily: 'inherit' }
