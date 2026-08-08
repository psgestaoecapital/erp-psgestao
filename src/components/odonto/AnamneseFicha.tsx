'use client'
// OD-4 · Anamnese na Ficha: preencher (modelos configuráveis) + assinar (reusa motor OD-3) + histórico
// + editor de modelos. Alertas críticos (alerta_se) sobem pro topo da Ficha via carregarAlertasAnamnese.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CardOdonto, EmptyStateOdonto, TOK } from './ui'

export type Pergunta = { id: string; texto: string; tipo: 'sim_nao' | 'texto' | 'multipla'; alerta_se?: string; alerta_label?: string; opcoes?: string[] }
type Modelo = { id: string; nome: string; perguntas: Pergunta[]; ativo?: boolean }
type Anamnese = { id: string; modelo_id: string | null; modelo_nome: string | null; respostas: Record<string, string>; preenchida_por: string; assinado: boolean; assinado_em: string | null; created_at: string | null }

const fmtData = (s: string | null | undefined) => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('pt-BR') } catch { return '—' } }

// Helper compartilhado: alertas da anamnese MAIS RECENTE do paciente (resposta bate com alerta_se).
export async function carregarAlertasAnamnese(companyId: string, pacienteId: string): Promise<string[]> {
  const { data: anas } = await supabase.rpc('fn_odonto_anamnese_paciente', { p_company_id: companyId, p_paciente_id: pacienteId })
  const latest = ((anas as Anamnese[] | null) ?? [])[0]
  if (!latest?.modelo_id) return []
  const { data: mod } = await supabase.from('erp_odonto_anamnese_modelo').select('perguntas').eq('id', latest.modelo_id).maybeSingle()
  const perguntas = ((mod?.perguntas as Pergunta[] | undefined) ?? [])
  const out: string[] = []
  for (const p of perguntas) {
    if (p.alerta_se && String(latest.respostas?.[p.id] ?? '').trim().toLowerCase() === String(p.alerta_se).trim().toLowerCase()) {
      out.push(p.alerta_label || p.texto)
    }
  }
  return out
}

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `0.5px solid ${TOK.line}`, borderRadius: 8, fontSize: 13, color: TOK.esp, background: '#fff', boxSizing: 'border-box' }
const btnGold: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: TOK.rCtrl, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnLine: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: TOK.esp, border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }

export function AnamneseFicha({ companyId, pacienteId, onAlertasMudou }: { companyId: string; pacienteId: string; onAlertasMudou?: () => void }) {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [anamneses, setAnamneses] = useState<Anamnese[]>([])
  const [carregando, setCarregando] = useState(true)
  const [view, setView] = useState<'lista' | 'nova' | 'modelos'>('lista')
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(null), 3500) }

  const carregar = useCallback(async () => {
    const [{ data: mods }, { data: anas }] = await Promise.all([
      supabase.from('erp_odonto_anamnese_modelo').select('id, nome, perguntas, ativo').eq('company_id', companyId).eq('ativo', true).order('nome'),
      supabase.rpc('fn_odonto_anamnese_paciente', { p_company_id: companyId, p_paciente_id: pacienteId }),
    ])
    setModelos((mods as Modelo[] | null) ?? [])
    setAnamneses((anas as Anamnese[] | null) ?? [])
    setCarregando(false)
  }, [companyId, pacienteId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const assinar = async (a: Anamnese) => {
    if (!confirm('Assinar esta anamnese? Depois de assinada, fica imutável — a correção é uma nova anamnese.')) return
    const { data, error } = await supabase.rpc('fn_odonto_anamnese_assinar', { p_company_id: companyId, p_anamnese_id: a.id, p_metodo: 'senha_app' })
    if (error || (data as { ok?: boolean })?.ok === false) { flash('Falha ao assinar.'); return }
    flash('Anamnese assinada.'); void carregar(); onAlertasMudou?.()
  }

  if (carregando) return <div style={{ color: TOK.mut, fontSize: 13 }}>Carregando anamnese…</div>

  if (view === 'nova') return <NovaAnamnese companyId={companyId} pacienteId={pacienteId} modelos={modelos}
    onCancel={() => setView('lista')} onSalvo={() => { setView('lista'); flash('Anamnese salva (sem assinatura). Assine no histórico.'); void carregar(); onAlertasMudou?.() }} />
  if (view === 'modelos') return <ModelosEditor companyId={companyId} modelos={modelos} onVoltar={() => { setView('lista'); void carregar() }} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setView('modelos')} style={btnLine}>⚙ Modelos</button>
        <button onClick={() => setView('nova')} style={btnGold} disabled={modelos.length === 0}>+ Nova anamnese</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600 }}>{msg}</div>}
      {modelos.length === 0 && <div style={{ fontSize: 12.5, color: TOK.amber }}>Nenhum modelo ativo. Crie um em <strong>Modelos</strong>.</div>}
      {anamneses.length === 0 ? (
        <EmptyStateOdonto titulo="Sem anamnese" linha="Registre a anamnese de saúde do paciente — alergias e condições viram alerta no topo da ficha." acao={modelos.length > 0 ? <button onClick={() => setView('nova')} style={btnGold}>+ Nova anamnese</button> : undefined} />
      ) : anamneses.map((a) => {
        const modelo = modelos.find((m) => m.id === a.modelo_id)
        return (
          <CardOdonto key={a.id} style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: TOK.esp }}>{fmtData(a.created_at)} · {a.modelo_nome || 'Anamnese'}{a.preenchida_por === 'paciente' ? ' · preenchida pelo paciente' : ''}</span>
              {a.assinado
                ? <span style={{ fontSize: 11, color: TOK.green, fontWeight: 700 }}>✓ Assinada{a.assinado_em ? ` · ${fmtData(a.assinado_em)}` : ''}</span>
                : <button onClick={() => void assinar(a)} style={{ ...btnGold, padding: '5px 12px', fontSize: 12 }}>Assinar</button>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(modelo?.perguntas ?? []).map((p) => {
                const r = a.respostas?.[p.id]
                if (!r) return null
                const alerta = p.alerta_se && String(r).toLowerCase() === String(p.alerta_se).toLowerCase()
                return (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                    <span style={{ color: TOK.mut }}>{p.texto}</span>
                    <span style={{ color: alerta ? TOK.red : TOK.esp, fontWeight: alerta ? 700 : 500, textAlign: 'right' }}>{r}{alerta ? ' ⚠' : ''}</span>
                  </div>
                )
              })}
              {!modelo && <div style={{ fontSize: 12, color: TOK.mut }}>{Object.entries(a.respostas ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'sem respostas'}</div>}
            </div>
          </CardOdonto>
        )
      })}
    </div>
  )
}

function NovaAnamnese({ companyId, pacienteId, modelos, onCancel, onSalvo }: {
  companyId: string; pacienteId: string; modelos: Modelo[]; onCancel: () => void; onSalvo: () => void
}) {
  const [modeloId, setModeloId] = useState(modelos[0]?.id ?? '')
  const [respostas, setRespostas] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const modelo = useMemo(() => modelos.find((m) => m.id === modeloId) ?? null, [modelos, modeloId])
  const set = (id: string, v: string) => setRespostas((s) => ({ ...s, [id]: v }))

  const salvar = async () => {
    if (!modelo) { setErro('Escolha um modelo.'); return }
    setSalvando(true); setErro(null)
    const alergiasTxt = respostas['alergia_quais'] || (respostas['alergia'] === 'sim' ? 'Ver anamnese' : '')
    const { data, error } = await supabase.rpc('fn_odonto_anamnese_salvar', {
      p_company_id: companyId, p_paciente_id: pacienteId, p_modelo_id: modelo.id, p_respostas: respostas,
      p_preenchida_por: 'profissional', p_alergias: alergiasTxt || null,
    })
    setSalvando(false)
    if (error || (data as { ok?: boolean })?.ok === false) { setErro((data as { erro?: string })?.erro || error?.message || 'Falha ao salvar.'); return }
    onSalvo()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onCancel} style={btnLine}>← Voltar</button>
        <select value={modeloId} onChange={(e) => { setModeloId(e.target.value); setRespostas({}) }} style={{ ...inp, width: 'auto', flex: 1 }}>
          {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
      </div>
      <CardOdonto style={{ padding: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(modelo?.perguntas ?? []).map((p) => (
            <div key={p.id}>
              <div style={{ fontSize: 12.5, color: TOK.esp, marginBottom: 5, fontWeight: 500 }}>{p.texto}</div>
              {p.tipo === 'sim_nao' ? (
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  {['sim', 'nao'].map((op) => (
                    <button key={op} onClick={() => set(p.id, op)} style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 16px', borderRadius: 999, cursor: 'pointer', border: `0.5px solid ${respostas[p.id] === op ? TOK.gold : TOK.line}`, background: respostas[p.id] === op ? TOK.gold : '#fff', color: respostas[p.id] === op ? '#fff' : TOK.mut }}>{op === 'sim' ? 'Sim' : 'Não'}</button>
                  ))}
                </div>
              ) : p.tipo === 'multipla' ? (
                <select value={respostas[p.id] ?? ''} onChange={(e) => set(p.id, e.target.value)} style={inp}>
                  <option value="">—</option>{(p.opcoes ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input value={respostas[p.id] ?? ''} onChange={(e) => set(p.id, e.target.value)} style={inp} placeholder="Resposta…" />
              )}
            </div>
          ))}
        </div>
        {erro && <div style={{ fontSize: 12.5, color: TOK.red, marginTop: 8 }}>{erro}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} style={btnLine}>Cancelar</button>
          <button onClick={() => void salvar()} disabled={salvando} style={{ ...btnGold, opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvando…' : 'Salvar anamnese'}</button>
        </div>
      </CardOdonto>
    </div>
  )
}

function ModelosEditor({ companyId, modelos, onVoltar }: { companyId: string; modelos: Modelo[]; onVoltar: () => void }) {
  const [sel, setSel] = useState<Modelo | 'novo' | null>(null)
  const [nome, setNome] = useState('')
  const [perguntas, setPerguntas] = useState<Pergunta[]>([])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const abrir = (m: Modelo | 'novo') => {
    setSel(m)
    if (m === 'novo') { setNome(''); setPerguntas([]) }
    else { setNome(m.nome); setPerguntas(m.perguntas ?? []) }
  }
  const addPergunta = () => setPerguntas((ps) => [...ps, { id: `q${ps.length + 1}_${Math.random().toString(36).slice(2, 6)}`, texto: '', tipo: 'sim_nao' }])
  const setP = (i: number, patch: Partial<Pergunta>) => setPerguntas((ps) => ps.map((p, ix) => ix === i ? { ...p, ...patch } : p))
  const rmP = (i: number) => setPerguntas((ps) => ps.filter((_, ix) => ix !== i))

  const salvar = async () => {
    if (!nome.trim()) { setMsg('Informe o nome do modelo.'); return }
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_odonto_anamnese_modelo_salvar', {
      p_company_id: companyId, p_modelo: { nome: nome.trim(), perguntas: perguntas.filter((p) => p.texto.trim()) },
      p_modelo_id: sel && sel !== 'novo' ? sel.id : null,
    })
    setSalvando(false)
    if (error || (data as { ok?: boolean })?.ok === false) { setMsg('Falha ao salvar o modelo.'); return }
    setMsg('Modelo salvo.'); setSel(null); onVoltar()
  }

  if (sel) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button onClick={() => setSel(null)} style={btnLine}>← Modelos</button>
      <CardOdonto style={{ padding: 14 }}>
        <div style={{ fontSize: 11, color: TOK.mut, marginBottom: 4 }}>Nome do modelo</div>
        <input value={nome} onChange={(e) => setNome(e.target.value)} style={inp} placeholder="Ex.: Anamnese de saúde" />
        <div style={{ fontSize: 11, color: TOK.mut, margin: '12px 0 6px' }}>Perguntas</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {perguntas.map((p, i) => (
            <div key={p.id} style={{ border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input value={p.texto} onChange={(e) => setP(i, { texto: e.target.value })} style={inp} placeholder="Texto da pergunta" />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={p.tipo} onChange={(e) => setP(i, { tipo: e.target.value as Pergunta['tipo'] })} style={{ ...inp, width: 'auto' }}>
                  <option value="sim_nao">Sim/Não</option><option value="texto">Texto</option><option value="multipla">Múltipla</option>
                </select>
                {p.tipo !== 'texto' && (
                  <input value={p.alerta_se ?? ''} onChange={(e) => setP(i, { alerta_se: e.target.value })} style={{ ...inp, width: 'auto', flex: 1 }} placeholder="alerta se resposta = (ex.: sim)" />
                )}
                {p.alerta_se ? <input value={p.alerta_label ?? ''} onChange={(e) => setP(i, { alerta_label: e.target.value })} style={{ ...inp, width: 'auto', flex: 1 }} placeholder="rótulo do alerta (ex.: Alergia)" /> : null}
                <button onClick={() => rmP(i)} style={{ background: 'none', border: 'none', color: TOK.red, cursor: 'pointer', fontSize: 13 }}>remover</button>
              </div>
            </div>
          ))}
        </div>
        <button onClick={addPergunta} style={{ ...btnLine, marginTop: 8 }}>+ Pergunta</button>
        {msg && <div style={{ fontSize: 12.5, color: TOK.green, marginTop: 8, fontWeight: 600 }}>{msg}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={() => setSel(null)} style={btnLine}>Cancelar</button>
          <button onClick={() => void salvar()} disabled={salvando} style={{ ...btnGold, opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvando…' : 'Salvar modelo'}</button>
        </div>
      </CardOdonto>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <button onClick={onVoltar} style={btnLine}>← Anamnese</button>
        <button onClick={() => abrir('novo')} style={btnGold}>+ Novo modelo</button>
      </div>
      {modelos.length === 0 ? <EmptyStateOdonto titulo="Sem modelos" linha="Crie um modelo de anamnese para a clínica." /> :
        modelos.map((m) => (
          <CardOdonto key={m.id} style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div><div style={{ fontSize: 13.5, fontWeight: 700, color: TOK.esp }}>{m.nome}</div><div style={{ fontSize: 11.5, color: TOK.mut }}>{(m.perguntas ?? []).length} pergunta(s)</div></div>
            <button onClick={() => abrir(m)} style={btnLine}>Editar</button>
          </CardOdonto>
        ))}
    </div>
  )
}
