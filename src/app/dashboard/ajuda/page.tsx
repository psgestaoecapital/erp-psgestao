'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', blue: '#42A5F5', espresso: '#3D2314' }

interface Msg { role: 'user' | 'assistant'; content: string }
interface ModInfo { id: string; nome: string; desc: string }

const QUICK_QUESTIONS = [
  'Como importar dados CSV?',
  'O que e a Curva ABC?',
  'Como funciona o Anti-Fraude?',
  'Como usar o Consultor IA?',
  'O que e o PS Assessor?',
  'Como fazer rateio de custos?',
  'Como analisar viabilidade?',
  'O que e o modulo Industrial?',
]

export default function AjudaPage() {
  const [tab, setTab] = useState<'chat' | 'modulos' | 'faq'>('chat')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState<any>(null)
  const [modulos, setModulos] = useState<ModInfo[]>([])
  const [moduloSel, setModuloSel] = useState<ModInfo | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/ajuda/context')
      .then(r => r.json())
      .then(data => {
        setContext(data)
        setModulos(data.modulos_menu || [])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [msgs])

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text || input.trim()
    if (!msg || loading) return
    setInput('')
    const newMsgs: Msg[] = [...msgs, { role: 'user', content: msg }]
    setMsgs(newMsgs)
    setLoading(true)

    try {
      const resp = await fetch('/api/ajuda/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: newMsgs.slice(-10),
          context: context,
        }),
      })
      const data = await resp.json()
      if (data.reply) {
        setMsgs([...newMsgs, { role: 'assistant', content: data.reply }])
      } else {
        setMsgs([...newMsgs, { role: 'assistant', content: 'Desculpe, ocorreu um erro. Tente novamente.' }])
      }
    } catch {
      setMsgs([...newMsgs, { role: 'assistant', content: 'Erro de conexao. Verifique sua internet.' }])
    }
    setLoading(false)
  }, [input, msgs, loading, context])

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }

  const tabSt = (t: string): React.CSSProperties => ({
    padding: '10px 20px', cursor: 'pointer', border: 'none', fontWeight: 600, fontSize: 13,
    background: tab === t ? C.gold : 'transparent', color: tab === t ? C.espresso : C.muted,
    borderRadius: '8px 8px 0 0',
  })

  const askAboutModule = (mod: ModInfo) => {
    setTab('chat')
    sendMessage('Explique em detalhes como usar o modulo ' + mod.nome + ' e de exemplos praticos')
  }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, margin: 0 }}>PS Ajuda</h1>
        {context && (
          <span style={{ fontSize: 10, color: C.muted, background: C.card, padding: '4px 10px', borderRadius: 12 }}>
            {context.versao} | {context.total_empresas} empresas | {context.total_lancamentos?.toLocaleString()} lancamentos
          </span>
        )}
      </div>
      <p style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Assistente inteligente com conhecimento completo do ERP</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 0 }}>
        <button style={tabSt('chat')} onClick={() => setTab('chat')}>Chat IA</button>
        <button style={tabSt('modulos')} onClick={() => setTab('modulos')}>Explorar Modulos</button>
        <button style={tabSt('faq')} onClick={() => setTab('faq')}>Perguntas Rapidas</button>
      </div>

      {/* Chat Tab */}
      {tab === 'chat' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', overflow: 'hidden' }}>
          {/* Messages */}
          <div ref={chatRef} style={{ height: 420, overflowY: 'auto', padding: 16 }}>
            {msgs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>{'\u{1F4AC}'}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: C.gold, marginBottom: 8 }}>Como posso ajudar?</div>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
                  Pergunte qualquer coisa sobre o ERP. Eu conheco todos os {modulos.length} modulos em detalhes.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                  {QUICK_QUESTIONS.slice(0, 4).map((q, i) => (
                    <button key={i} onClick={() => sendMessage(q)} style={{
                      background: C.bg, border: '1px solid ' + C.border, color: C.text,
                      padding: '8px 14px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                    }}>{q}</button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
                <div style={{
                  maxWidth: '85%', padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.6,
                  background: m.role === 'user' ? C.gold : C.bg,
                  color: m.role === 'user' ? C.espresso : C.text,
                  borderTopRightRadius: m.role === 'user' ? 4 : 12,
                  borderTopLeftRadius: m.role === 'user' ? 12 : 4,
                  whiteSpace: 'pre-wrap',
                }}>
                  {m.role === 'assistant' && <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, marginBottom: 4 }}>PS Ajuda</div>}
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
                <div style={{ background: C.bg, padding: '10px 14px', borderRadius: 12, fontSize: 13, color: C.muted }}>
                  <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, marginBottom: 4 }}>PS Ajuda</div>
                  Analisando...
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid ' + C.border }}>
            <input
              value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
              placeholder="Pergunte sobre qualquer modulo do ERP..."
              style={{ flex: 1, background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '10px 14px', borderRadius: 8, fontSize: 13 }}
            />
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{
              background: C.gold, color: C.espresso, border: 'none', padding: '10px 20px', borderRadius: 8,
              fontWeight: 700, cursor: 'pointer', opacity: loading || !input.trim() ? 0.4 : 1,
            }}>Enviar</button>
          </div>
        </div>
      )}

      {/* Modules Tab */}
      {tab === 'modulos' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {modulos.map((mod) => (
              <div key={mod.id} style={{
                background: C.bg, borderRadius: 8, padding: 14, cursor: 'pointer',
                borderLeft: '3px solid ' + (moduloSel?.id === mod.id ? C.gold : C.border),
                transition: '0.15s',
              }} onClick={() => setModuloSel(moduloSel?.id === mod.id ? null : mod)}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.gold, marginBottom: 4 }}>{mod.nome}</div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{mod.desc}</div>
                {moduloSel?.id === mod.id && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                    <a href={'/dashboard/' + mod.id} style={{
                      background: C.gold, color: C.espresso, padding: '6px 12px', borderRadius: 6,
                      fontSize: 11, fontWeight: 700, textDecoration: 'none',
                    }}>Abrir Modulo</a>
                    <button onClick={(e) => { e.stopPropagation(); askAboutModule(mod) }} style={{
                      background: C.border, color: C.text, border: 'none', padding: '6px 12px',
                      borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>Perguntar ao IA</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FAQ Tab */}
      {tab === 'faq' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.gold, marginBottom: 12 }}>Perguntas frequentes - clique para perguntar ao IA</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {QUICK_QUESTIONS.map((q, i) => (
              <button key={i} onClick={() => { setTab('chat'); sendMessage(q) }} style={{
                background: C.bg, border: '1px solid ' + C.border, color: C.text,
                padding: '12px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>{q}</span>
                <span style={{ color: C.gold, fontSize: 16, flexShrink: 0, marginLeft: 8 }}>{'>'}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 20, background: C.bg, borderRadius: 8, padding: 16, borderLeft: '3px solid ' + C.blue }}>
            <div style={{ fontWeight: 700, color: C.blue, marginBottom: 6 }}>Dica</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              O PS Ajuda conhece todos os {modulos.length} modulos do ERP em tempo real. 
              Voce pode perguntar coisas especificas como "como importar um OFX do Bradesco" 
              ou "como detectar duplicatas nos lancamentos" e ele vai dar instrucoes passo a passo.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}