'use client'
// Pdois #97 + #98 (CEO 01/10): TAREFAS no lead, no lugar do registro de reunião. Tipos: ligar, WhatsApp, reunião, visita,
// e-mail, outro · data/hora · responsável · situação (a fazer / feita / cancelada) · resultado. Gravação só pelas funções
// do banco (fn_lead_tarefa_salvar / fn_lead_tarefa_situacao): a tarefa entra na agenda do responsável e, quando atribuída
// por outra pessoa, chega no sino dele. WhatsApp abre o wa.me com o número do lead (sem integração paga, RD-42).
import { useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO = '#C8941A'
const BORDA = '#E7DED3'
const TEXTM = '#6b5444'
const GREEN = '#1F5A1F'
const RED = '#7A1F1F'

import { TIPOS_TAREFA, tipoTarefa, whatsappHref, quando, atrasada, hoje, type Tarefa, type TarefaTipo, type TarefaSituacao, type LeadRef } from '@/lib/pm/tarefas'
export { TIPOS_TAREFA, tipoTarefa, whatsappHref, quando, atrasada, SELECT_TAREFA } from '@/lib/pm/tarefas'
export type { Tarefa, TarefaTipo, TarefaSituacao, LeadRef } from '@/lib/pm/tarefas'

type Rpc = { ok?: boolean; erro?: string; mensagem?: string }

// ── Tarefas de um lead: lista + nova/editar + feita/cancelar com resultado ──────────────────────────────────────
export function TarefasLeadModal({ empresa, lead, tarefas, respMap, uid, onClose, onSaved, setToast }: {
  empresa: string; lead: LeadRef; tarefas: Tarefa[]; respMap: Record<string, string>; uid: string | null
  onClose: () => void; onSaved: () => void; setToast: (s: string) => void
}) {
  const [edit, setEdit] = useState<Tarefa | null>(null)
  const [tipo, setTipo] = useState<TarefaTipo>('ligar')
  const [titulo, setTitulo] = useState('')
  const [data, setData] = useState(hoje())
  const [hora, setHora] = useState('')
  const [resp, setResp] = useState(uid ?? '')
  const [busy, setBusy] = useState(false)
  const [concluindo, setConcluindo] = useState<{ t: Tarefa; sit: TarefaSituacao } | null>(null)
  const [resultado, setResultado] = useState('')
  const wa = whatsappHref(lead.contato_telefone)

  function editar(t: Tarefa) {
    setEdit(t); setTipo(t.tipo); setTitulo(t.titulo); setData(t.data); setHora(t.hora?.slice(0, 5) ?? ''); setResp(t.responsavel_id ?? '')
  }
  function limpar() { setEdit(null); setTipo('ligar'); setTitulo(''); setData(hoje()); setHora(''); setResp(uid ?? '') }

  async function salvar() {
    if (!titulo.trim()) { setToast('Escreva o que precisa ser feito.'); return }
    setBusy(true)
    try {
      const { data: r, error } = await supabase.rpc('fn_lead_tarefa_salvar', {
        p_company_id: empresa, p_id: edit?.id ?? null,
        p_dados: { tipo, titulo: titulo.trim(), data, hora: hora || null, responsavel_id: resp || null, lead_id: lead.id },
      })
      const rr = r as Rpc | null
      if (error || !rr?.ok) { setToast('Não salvou: ' + (rr?.mensagem ?? error?.message ?? rr?.erro ?? 'falhou')); return }
      setToast(edit ? 'Tarefa alterada.' : resp && resp !== uid ? 'Tarefa criada e atribuída — o responsável foi avisado.' : 'Tarefa criada.')
      limpar(); onSaved()
    } finally { setBusy(false) }
  }

  async function mudarSituacao() {
    if (!concluindo) return
    setBusy(true)
    try {
      const { data: r, error } = await supabase.rpc('fn_lead_tarefa_situacao', { p_id: concluindo.t.id, p_situacao: concluindo.sit, p_resultado: resultado.trim() || null })
      const rr = r as Rpc | null
      if (error || !rr?.ok) { setToast('Não salvou: ' + (error?.message ?? rr?.erro ?? 'falhou')); return }
      setToast(concluindo.sit === 'feita' ? 'Tarefa feita.' : 'Tarefa cancelada.')
      setConcluindo(null); setResultado(''); onSaved()
    } finally { setBusy(false) }
  }

  const ordenadas = [...tarefas].sort((a, b) => (a.situacao === 'a_fazer' ? 0 : 1) - (b.situacao === 'a_fazer' ? 0 : 1) || a.data.localeCompare(b.data))
  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()} data-testid="tarefas-lead">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>✅ Tarefas · {lead.empresa || lead.nome}</h2>
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" data-testid="tarefas-whatsapp" style={waBtn}>💬 WhatsApp</a>}
          <button onClick={onClose} style={{ marginLeft: 'auto', ...ghost }} aria-label="Fechar">✕</button>
        </div>

        {ordenadas.length === 0
          ? <p style={{ fontSize: 13, color: TEXTM }}>Nenhuma tarefa ainda. Crie a primeira abaixo.</p>
          : (
            <div style={{ display: 'grid', gap: 6, marginBottom: 12, maxHeight: 260, overflowY: 'auto' }}>
              {ordenadas.map((t) => {
                const tp = tipoTarefa(t.tipo)
                return (
                  <div key={t.id} data-testid={`tarefa-${t.id}`} style={{ border: `1px solid ${atrasada(t) ? RED : BORDA}`, borderRadius: 8, padding: '7px 9px', background: t.situacao === 'a_fazer' ? '#fff' : OFFWHITE, opacity: t.situacao === 'cancelada' ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                      <span>{tp.i}</span><strong>{tp.l}</strong><span>— {t.titulo}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: atrasada(t) ? RED : TEXTM, fontWeight: atrasada(t) ? 700 : 400 }}>{quando(t)}{atrasada(t) ? ' · atrasada' : ''}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: TEXTM, marginTop: 2 }}>
                      resp: {t.responsavel_id ? (respMap[t.responsavel_id] ?? t.responsavel_nome ?? '—') : (t.responsavel_nome ?? '—')}
                      {' · '}{t.situacao === 'a_fazer' ? 'a fazer' : t.situacao === 'feita' ? 'feita' : 'cancelada'}
                      {t.resultado && <> · resultado: {t.resultado}</>}
                    </div>
                    {t.situacao === 'a_fazer' && (
                      <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                        <button onClick={() => { setConcluindo({ t, sit: 'feita' }); setResultado('') }} style={mini(GREEN)} data-testid={`tarefa-feita-${t.id}`}>✓ Feita</button>
                        <button onClick={() => editar(t)} style={mini('#2F5AA8')}>✏️ Editar</button>
                        <button onClick={() => { setConcluindo({ t, sit: 'cancelada' }); setResultado('') }} style={mini(RED)}>Cancelar</button>
                      </div>
                    )}
                    {concluindo?.t.id === t.id && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <input value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder={concluindo.sit === 'feita' ? 'Resultado (ex.: pediu proposta até sexta)' : 'Motivo (opcional)'}
                          style={{ ...inp, flex: 1 }} data-testid="tarefa-resultado" />
                        <button disabled={busy} onClick={() => void mudarSituacao()} style={pri} data-testid="tarefa-confirmar">Confirmar</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

        <div style={{ borderTop: `1px solid ${BORDA}`, paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{edit ? 'Editar tarefa' : 'Nova tarefa'}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
            {TIPOS_TAREFA.map((t) => (
              <button key={t.v} type="button" onClick={() => setTipo(t.v)} data-testid={`tarefa-tipo-${t.v}`}
                style={{ ...mini(tipo === t.v ? DOURADO : TEXTM), background: tipo === t.v ? '#FBF3DE' : '#fff' }}>{t.i} {t.l}</button>
            ))}
          </div>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="O que precisa ser feito (ex.: ligar para apresentar a proposta)"
            style={{ ...inp, width: '100%', marginBottom: 8 }} data-testid="tarefa-titulo" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <label style={lbl}>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inp} data-testid="tarefa-data" /></label>
            <label style={lbl}>Hora<input type="time" value={hora} onChange={(e) => setHora(e.target.value)} style={inp} data-testid="tarefa-hora" /></label>
            <label style={lbl}>Responsável
              <select value={resp} onChange={(e) => setResp(e.target.value)} style={inp} data-testid="tarefa-responsavel">
                {uid && <option value={uid}>Eu{respMap[uid] ? ` (${respMap[uid]})` : ''}</option>}
                {Object.entries(respMap).filter(([id]) => id !== uid).sort((a, b) => a[1].localeCompare(b[1])).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            {edit && <button onClick={limpar} style={ghost}>Nova</button>}
            <button disabled={busy} onClick={() => void salvar()} style={pri} data-testid="tarefa-salvar">{edit ? 'Salvar' : 'Criar tarefa'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Minhas tarefas: o que está comigo, a fazer, por data (atrasadas primeiro) ──────────────────────────────────
export function MinhasTarefasModal({ tarefas, leads, onAbrirLead, onClose }: {
  tarefas: Tarefa[]; leads: Record<string, LeadRef>; onAbrirLead: (l: LeadRef) => void; onClose: () => void
}) {
  const lista = [...tarefas].sort((a, b) => a.data.localeCompare(b.data) || (a.hora ?? '').localeCompare(b.hora ?? ''))
  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()} data-testid="minhas-tarefas">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>✅ Minhas tarefas</h2>
          <span style={{ marginLeft: 8, fontSize: 12, color: TEXTM }}>{lista.length} a fazer</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', ...ghost }} aria-label="Fechar">✕</button>
        </div>
        {lista.length === 0 && <p style={{ fontSize: 13, color: TEXTM }}>Nada pendente com você. 🎉</p>}
        <div style={{ display: 'grid', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
          {lista.map((t) => {
            const tp = tipoTarefa(t.tipo); const l = t.lead_id ? leads[t.lead_id] : undefined
            const wa = whatsappHref(l?.contato_telefone)
            return (
              <div key={t.id} data-testid={`minha-tarefa-${t.id}`} style={{ border: `1px solid ${atrasada(t) ? RED : BORDA}`, borderRadius: 8, padding: '7px 9px', background: '#fff' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                  <span>{tp.i}</span><strong>{tp.l}</strong><span>— {t.titulo}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: atrasada(t) ? RED : TEXTM, fontWeight: atrasada(t) ? 700 : 400 }}>{quando(t)}{atrasada(t) ? ' · atrasada' : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, fontSize: 12, color: TEXTM }}>
                  {l ? <span>{l.empresa || l.nome}</span> : <span>—</span>}
                  {wa && <a href={wa} target="_blank" rel="noopener noreferrer" style={waBtn}>💬 WhatsApp</a>}
                  {l && <button onClick={() => onAbrirLead(l)} style={{ ...mini(DOURADO), marginLeft: 'auto' }}>Abrir tarefas do lead</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(30,20,10,.45)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px', overflowY: 'auto' }
const card: CSSProperties = { background: '#fff', color: ESPRESSO, borderRadius: 14, padding: 16, width: '100%', maxWidth: 620, boxShadow: '0 10px 40px rgba(0,0,0,.2)' }
const inp: CSSProperties = { border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 38, background: '#fff', color: ESPRESSO, boxSizing: 'border-box' }
const lbl: CSSProperties = { display: 'grid', gap: 3, fontSize: 11.5, color: TEXTM }
const pri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 9, padding: '8px 14px', cursor: 'pointer', fontWeight: 700 }
const ghost: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 9, padding: '6px 10px', cursor: 'pointer' }
const waBtn: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: '#fff', background: '#1F7A3A', borderRadius: 7, padding: '3px 8px', textDecoration: 'none' }
const mini = (cor: string): CSSProperties => ({ border: `1px solid ${cor}`, color: cor, background: '#fff', borderRadius: 7, padding: '3px 8px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 })
