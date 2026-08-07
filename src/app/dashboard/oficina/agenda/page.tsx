'use client'

// A1 · Agenda da Oficina (entidade genérica erp_agendamento). Dia/Semana, +Agendar, status com semáforo.
// Oficina GENÉRICA: placa/veículo são opcionais e vão em `dados` (jsonb) — nunca obrigatórios. Tudo de
// fn_agenda_listar / fn_agendamento_criar / fn_agendamento_mudar_status por company_id (RD-38). 3 estados.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', AMBAR = '#B45309', VERM = '#B91C1C'
const iso = (d: Date) => d.toISOString().slice(0, 10)
const somaDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const inicioSemana = (d: Date) => somaDias(d, -((d.getDay() + 6) % 7)) // segunda
const fmtDiaCurto = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
const HORAS = Array.from({ length: 13 }, (_, i) => 7 + i) // 07..19

type Ag = {
  id: string; company_id: string; origem_modulo: string; titulo: string | null; cliente_nome: string | null
  responsavel_nome: string | null; data: string; hora_inicio: string | null; hora_fim: string | null
  status: string; dados: { placa?: string; veiculo?: string; defeito?: string } | null; observacao: string | null
}
const ST: Record<string, { label: string; cor: string; bg: string }> = {
  agendado: { label: 'Agendado', cor: MUT, bg: '#F2ECE1' },
  confirmado: { label: 'Confirmado', cor: '#A57A15', bg: '#FBF4E4' },
  em_atendimento: { label: 'Em atendimento', cor: AMBAR, bg: '#FBF0DD' },
  concluido: { label: 'Concluído', cor: VERDE, bg: '#EAF5EE' },
  cancelado: { label: 'Cancelado', cor: VERM, bg: '#FBEAEA' },
  nao_compareceu: { label: 'Não compareceu', cor: VERM, bg: '#FBEAEA' },
}
const ACOES: Record<string, { s: string; l: string }[]> = {
  agendado: [{ s: 'confirmado', l: 'Confirmar' }, { s: 'cancelado', l: 'Cancelar' }, { s: 'nao_compareceu', l: 'Não veio' }],
  confirmado: [{ s: 'em_atendimento', l: 'Iniciar' }, { s: 'cancelado', l: 'Cancelar' }, { s: 'nao_compareceu', l: 'Não veio' }],
  em_atendimento: [{ s: 'concluido', l: 'Concluir' }],
  concluido: [], cancelado: [{ s: 'agendado', l: 'Reabrir' }], nao_compareceu: [{ s: 'agendado', l: 'Reabrir' }],
}

export default function OficinaAgendaPage() {
  const { companyIds, sel, selInfo } = useCompanyIds()
  const companyId = selInfo?.tipo === 'empresa' && sel ? sel : (companyIds?.[0] ?? null)
  const [modo, setModo] = useState<'dia' | 'semana'>('dia')
  const [ref, setRef] = useState(() => new Date())
  const [ags, setAgs] = useState<Ag[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [msg, setMsg] = useState('')
  const [novo, setNovo] = useState(false)

  const range = useMemo(() => {
    if (modo === 'dia') return { de: iso(ref), ate: iso(ref) }
    const i = inicioSemana(ref); return { de: iso(i), ate: iso(somaDias(i, 6)) }
  }, [modo, ref])

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    const { data, error } = await supabase.rpc('fn_agenda_listar', { p_company_ids: companyIds, p_origem: 'oficina', p_de: range.de, p_ate: range.ate })
    setLoading(false)
    if (error) { setErro(error.message); return }
    setAgs((data as Ag[]) ?? [])
  }, [companyIds, range])

  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  async function mudarStatus(a: Ag, s: string) {
    setMsg('')
    const { error } = await supabase.rpc('fn_agendamento_mudar_status', { p_id: a.id, p_status: s })
    if (error) { setMsg('Erro: ' + error.message); return }
    const verbo = s === 'confirmado' ? 'CONFIRMOU' : s === 'concluido' ? 'CONCLUIU' : s === 'em_atendimento' ? 'INICIOU' : 'ATUALIZOU'
    setMsg(`${verbo} o agendamento${a.cliente_nome ? ` de ${a.cliente_nome}` : ''}.`)
    void carregar()
  }

  const diasSemana = useMemo(() => { const i = inicioSemana(ref); return Array.from({ length: 7 }, (_, k) => iso(somaDias(i, k))) }, [ref])
  const porDiaHora = (dia: string, hora: number) => ags.filter((a) => a.data === dia && Number((a.hora_inicio ?? '').slice(0, 2)) === hora)
  const semHora = (dia: string) => ags.filter((a) => a.data === dia && !a.hora_inicio)

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Oficina</div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>Agenda</h1>
          </div>
          <button onClick={() => setNovo(true)} disabled={!companyId} style={{ ...btnPrim, opacity: companyId ? 1 : 0.5 }}>+ Agendar</button>
        </div>

        {/* controles */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['dia', 'semana'] as const).map((m) => <button key={m} onClick={() => setModo(m)} style={{ ...tabBtn, ...(modo === m ? tabOn : {}) }}>{m === 'dia' ? 'Dia' : 'Semana'}</button>)}
          </div>
          <button onClick={() => setRef((d) => somaDias(d, modo === 'dia' ? -1 : -7))} style={btnGhost}>←</button>
          <button onClick={() => setRef(new Date())} style={btnGhost}>Hoje</button>
          <button onClick={() => setRef((d) => somaDias(d, modo === 'dia' ? 1 : 7))} style={btnGhost}>→</button>
          <span style={{ fontSize: 13, color: ESP, fontWeight: 600 }}>
            {modo === 'dia' ? new Date(range.de + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) : `${fmtDiaCurto(range.de)} – ${fmtDiaCurto(range.ate)}`}
          </span>
        </div>

        {msg && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 10, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        {erro ? (
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `4px solid ${VERM}`, borderRadius: 12, padding: 16, color: ESP }}><b>Não deu para carregar a agenda</b><div style={{ fontSize: 12.5, color: MUT, marginTop: 4 }}>{erro}</div></div>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
        ) : ags.length === 0 ? (
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>🗓️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginTop: 6 }}>Nenhum agendamento neste período</div>
            <div style={{ fontSize: 13, color: MUT, maxWidth: 420, margin: '8px auto 0', lineHeight: 1.5 }}>Toque em <b>+ Agendar</b> para programar um atendimento.</div>
          </div>
        ) : modo === 'dia' ? (
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
            {semHora(range.de).length > 0 && (
              <div style={{ padding: '8px 12px', borderBottom: `0.5px solid ${BG}` }}>
                <div style={{ fontSize: 10.5, color: MUT, marginBottom: 4 }}>SEM HORÁRIO</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{semHora(range.de).map((a) => <Card key={a.id} a={a} onStatus={mudarStatus} />)}</div>
              </div>
            )}
            {HORAS.map((h) => {
              const its = porDiaHora(range.de, h)
              return (
                <div key={h} style={{ display: 'grid', gridTemplateColumns: '54px 1fr', borderTop: `0.5px solid ${BG}`, minHeight: 40 }}>
                  <div style={{ fontSize: 11, color: MUT, padding: '8px 10px', borderRight: `0.5px solid ${BG}` }}>{String(h).padStart(2, '0')}:00</div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>{its.map((a) => <Card key={a.id} a={a} onStatus={mudarStatus} />)}</div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(130px,1fr))', gap: 8, overflowX: 'auto' }}>
            {diasSemana.map((dia) => {
              const its = ags.filter((a) => a.data === dia)
              return (
                <div key={dia} style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: 8, minHeight: 120 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: ESP, marginBottom: 6, textTransform: 'capitalize' }}>{fmtDiaCurto(dia)}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{its.length === 0 ? <span style={{ fontSize: 11, color: MUT }}>—</span> : its.map((a) => <Card key={a.id} a={a} onStatus={mudarStatus} compact />)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {novo && companyId && <ModalNovo companyId={companyId} dataDefault={modo === 'dia' ? range.de : iso(new Date())} onClose={() => setNovo(false)} onCriou={(m) => { setNovo(false); setMsg(m); void carregar() }} />}
    </div>
  )
}

function Card({ a, onStatus, compact }: { a: Ag; onStatus: (a: Ag, s: string) => void; compact?: boolean }) {
  const st = ST[a.status] ?? ST.agendado
  const veic = [a.dados?.placa, a.dados?.veiculo].filter(Boolean).join(' · ')
  return (
    <div style={{ background: st.bg, border: `0.5px solid ${LINE}`, borderLeft: `3px solid ${st.cor}`, borderRadius: 8, padding: '6px 9px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: ESP }}>{a.hora_inicio ? a.hora_inicio.slice(0, 5) : '—'}{a.hora_fim ? `–${a.hora_fim.slice(0, 5)}` : ''}</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: st.cor }}>{st.label}</span>
      </div>
      <div style={{ fontSize: 12.5, color: ESP, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.cliente_nome || a.titulo || 'Sem cliente'}</div>
      {veic && <div style={{ fontSize: 11, color: MUT }}>{veic}</div>}
      {!compact && a.responsavel_nome && <div style={{ fontSize: 10.5, color: MUT }}>👤 {a.responsavel_nome}</div>}
      {!compact && (ACOES[a.status] ?? []).length > 0 && (
        <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
          {(ACOES[a.status] ?? []).map((ac) => (
            <button key={ac.s} onClick={() => onStatus(a, ac.s)} style={{ fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#FFF', color: ac.s === 'cancelado' || ac.s === 'nao_compareceu' ? VERM : ESP }}>{ac.l}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function ModalNovo({ companyId, dataDefault, onClose, onCriou }: { companyId: string; dataDefault: string; onClose: () => void; onCriou: (msg: string) => void }) {
  const [f, setF] = useState({ cliente: '', placa: '', veiculo: '', responsavel: '', data: dataDefault, hi: '09:00', hf: '10:00', obs: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function salvar() {
    if (!f.cliente.trim() && !f.placa.trim()) { setErr('Informe ao menos o cliente ou a placa.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('fn_agendamento_criar', {
      p_company_id: companyId, p_origem: 'oficina', p_titulo: null,
      p_cliente_id: null, p_cliente_nome: f.cliente.trim() || null,
      p_responsavel_id: null, p_responsavel_nome: f.responsavel.trim() || null,
      p_data: f.data, p_hora_inicio: f.hi || null, p_hora_fim: f.hf || null,
      p_dados: { placa: f.placa.trim() || undefined, veiculo: f.veiculo.trim() || undefined },
      p_observacao: f.obs.trim() || null, p_orcamento_id: null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onCriou(`CRIOU agendamento${f.cliente ? ` para ${f.cliente}` : ''}.`)
  }
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 14, padding: 20, width: '100%', maxWidth: 440, border: `0.5px solid ${LINE}`, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, color: ESP, margin: '0 0 12px' }}>Novo agendamento</h3>
        {err && <div style={{ padding: '7px 10px', borderRadius: 8, background: '#FBEAEA', color: VERM, fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <Campo l="Cliente"><input value={f.cliente} onChange={(e) => set('cliente', e.target.value)} placeholder="Nome do cliente" style={inp} /></Campo>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 }}>
          <Campo l="Placa (opcional)"><input value={f.placa} onChange={(e) => set('placa', e.target.value.toUpperCase())} placeholder="ABC1D23" style={inp} /></Campo>
          <Campo l="Veículo (opcional)"><input value={f.veiculo} onChange={(e) => set('veiculo', e.target.value)} placeholder="Compass 2017" style={inp} /></Campo>
        </div>
        <Campo l="Mecânico responsável (opcional)"><input value={f.responsavel} onChange={(e) => set('responsavel', e.target.value)} placeholder="Nome do mecânico" style={inp} /></Campo>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8 }}>
          <Campo l="Data"><input type="date" value={f.data} onChange={(e) => set('data', e.target.value)} style={inp} /></Campo>
          <Campo l="Início"><input type="time" value={f.hi} onChange={(e) => set('hi', e.target.value)} style={inp} /></Campo>
          <Campo l="Fim"><input type="time" value={f.hf} onChange={(e) => set('hf', e.target.value)} style={inp} /></Campo>
        </div>
        <Campo l="Observação"><textarea value={f.obs} onChange={(e) => set('obs', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} /></Campo>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} style={btnGhost}>Cancelar</button>
          <button onClick={salvar} disabled={busy} style={btnPrim}>{busy ? 'Salvando…' : 'Agendar'}</button>
        </div>
      </div>
    </div>
  )
}
function Campo({ l, children }: { l: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', marginBottom: 8 }}><span style={{ display: 'block', fontSize: 10.5, color: MUT, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>{l}</span>{children}</label>
}
const inp: React.CSSProperties = { width: '100%', fontSize: 13, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP, boxSizing: 'border-box' }
const btnPrim: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#FFF', background: ESP, border: 'none', borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: ESP, background: '#FFF', border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }
const tabBtn: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: '6px 14px', border: `1px solid ${LINE}`, background: '#FFF', color: MUT, cursor: 'pointer', borderRadius: 8 }
const tabOn: React.CSSProperties = { border: `1px solid ${GOLD}`, background: '#FBF4E4', color: '#A57A15' }
