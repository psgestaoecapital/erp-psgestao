'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'

interface Msg { role: 'user' | 'assistant'; content: string }

const SUGESTOES = [
  'Como importar dados CSV?',
  'Como funciona o Anti-Fraude?',
  'Como usar o Consultor IA?',
  'O que e o PS Assessor?',
  'Como analisar custos?',
  'O que aparece na Visao Diaria?',
]

export default function HelpWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState<any>(null)
  const [pulse, setPulse] = useState(true)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/ajuda/context').then(r => r.json()).then(setContext).catch(() => {})
    const t = setTimeout(() => setPulse(false), 5000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [msgs, open])

  const send = useCallback(async (text?: string) => {
    const msg = text || input.trim()
    if (!msg || loading) return
    setInput('')
    const updated: Msg[] = [...msgs, { role: 'user', content: msg }]
    setMsgs(updated)
    setLoading(true)
    try {
      const resp = await fetch('/api/ajuda/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: updated.slice(-10), context }),
      })
      const data = await resp.json()
      setMsgs([...updated, { role: 'assistant', content: data.reply || 'Erro. Tente novamente.' }])
    } catch {
      setMsgs([...updated, { role: 'assistant', content: 'Erro de conexao.' }])
    }
    setLoading(false)
  }, [input, msgs, loading, context])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); setPulse(false) }} style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
        width: 56, height: 56, borderRadius: '50%',
        background: '#C8941A', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 20px rgba(200,148,26,0.4)',
        animation: pulse ? 'helpPulse 2s infinite' : 'none',
        transition: 'transform 0.2s',
      }}
      onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}>
        <span style={{ fontSize: 24, color: '#3D2314' }}>?</span>
        <style>{'@keyframes helpPulse { 0%,100% { box-shadow: 0 4px 20px rgba(200,148,26,0.4); } 50% { box-shadow: 0 4px 30px rgba(200,148,26,0.8); } }'}</style>
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      width: 380, height: 520, maxHeight: 'calc(100vh - 40px)', maxWidth: 'calc(100vw - 40px)',
      background: '#1A1410', borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
      border: '1px solid #2A2822',
    }}>
      {/* Header */}
      <div style={{
        background: '#3D2314', padding: '14px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#C8941A' }}>PS Ajuda</div>
          <div style={{ fontSize: 10, color: '#B0AB9F' }}>Assistente inteligente do ERP</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setMsgs([])} title="Limpar" style={{
            background: 'transparent', border: 'none', color: '#B0AB9F', cursor: 'pointer', fontSize: 16, padding: 4,
          }}>{'\u{21BB}'}</button>
          <button onClick={() => setOpen(false)} style={{
            background: 'transparent', border: 'none', color: '#B0AB9F', cursor: 'pointer', fontSize: 20, padding: 4,
          }}>{'\u{2715}'}</button>
        </div>
      </div>

      {/* Messages */}
      <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {msgs.length === 0 && (
          <div style={{ padding: '16px 4px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#C8941A', marginBottom: 12, textAlign: 'center' }}>Como posso ajudar?</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SUGESTOES.map((q, i) => (
                <button key={i} onClick={() => send(q)} style={{
                  background: '#0F0F0F', border: '1px solid #2A2822', color: '#FAF7F2',
                  padding: '7px 12px', borderRadius: 16, fontSize: 11, cursor: 'pointer',
                  textAlign: 'left', lineHeight: 1.3,
                }}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <div style={{
              maxWidth: '82%', padding: '9px 13px', borderRadius: 12, fontSize: 12, lineHeight: 1.6,
              background: m.role === 'user' ? '#C8941A' : '#0F0F0F',
              color: m.role === 'user' ? '#3D2314' : '#FAF7F2',
              borderBottomRightRadius: m.role === 'user' ? 4 : 12,
              borderBottomLeftRadius: m.role === 'user' ? 12 : 4,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {m.role === 'assistant' && <div style={{ fontSize: 9, color: '#C8941A', fontWeight: 700, marginBottom: 3 }}>PS Ajuda</div>}
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', marginBottom: 10 }}>
            <div style={{ background: '#0F0F0F', padding: '9px 13px', borderRadius: 12, fontSize: 12, color: '#B0AB9F' }}>
              <span style={{ fontSize: 9, color: '#C8941A', fontWeight: 700 }}>PS Ajuda</span><br/>Analisando...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #2A2822', display: 'flex', gap: 8 }}>
        <input
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
          placeholder="Pergunte qualquer coisa..."
          style={{
            flex: 1, background: '#0F0F0F', border: '1px solid #2A2822', color: '#FAF7F2',
            padding: '9px 12px', borderRadius: 8, fontSize: 12, outline: 'none',
          }}
        />
        <button onClick={() => send()} disabled={loading || !input.trim()} style={{
          background: '#C8941A', color: '#3D2314', border: 'none', padding: '9px 16px',
          borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 12,
          opacity: loading || !input.trim() ? 0.4 : 1,
        }}>Enviar</button>
      </div>
    </div>
  )
}