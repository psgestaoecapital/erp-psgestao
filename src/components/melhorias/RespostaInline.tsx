'use client'
// #61 (Jordana · Central de Melhorias) · substitui os window.prompt de resposta/motivo por um textarea
// INLINE com rascunho salvo em localStorage. window.prompt é de UMA linha e some (perde o texto) se a
// pessoa troca de janela pra conferir algo — foi o que silenciava chamado (ela desistia de reescrever).
// Aqui: várias linhas, e o rascunho persiste por chave (tela+ação+id). Só limpa ao ENVIAR; cancelar
// preserva (nada se perde). localStorage em try/catch (aba privada/bloqueado não quebra a tela · RD-51).
//
// #63 · ditar por voz: no celular, gravar é rápido e não há rascunho pra perder. Usa a Web Speech API
// (client-side, pt-BR, GRÁTIS, sem chamada de servidor — mesmo padrão do VozSoap do odonto). A transcrição
// cai NO textarea e fica editável: a pessoa CONFERE e ajusta antes de enviar (nunca envia às cegas).
// Navegador sem suporte → o 🎙️ some, só digita (fallback honesto · RD-51).
import { useCallback, useEffect, useRef, useState } from 'react'

function lerRascunho(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}
function salvarRascunho(key: string, v: string) {
  try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key) } catch { /* private mode */ }
}

// Web Speech API (não vem no lib.dom estável entre navegadores) — tipos mínimos.
type RecResultAlt = { transcript: string }
type RecResult = ArrayLike<RecResultAlt> & { isFinal: boolean }
type RecEvent = { resultIndex: number; results: ArrayLike<RecResult> }
type RecLike = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void;
  onresult: ((e: RecEvent) => void) | null; onerror: (() => void) | null; onend: (() => void) | null }
type RecCtor = new () => RecLike
function getRecCtor(): RecCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function RespostaInline({
  draftKey, placeholder, submitLabel = 'Enviar', initial = '', obrigatorio = true, busy = false,
  onSubmit, onCancel,
}: {
  draftKey: string
  placeholder: string
  submitLabel?: string
  initial?: string
  obrigatorio?: boolean
  busy?: boolean
  onSubmit: (texto: string) => void | Promise<void>
  onCancel: () => void
}) {
  // rascunho salvo vence o initial (se a pessoa já tinha escrito e saiu, volta com o texto dela)
  const [texto, setTexto] = useState(() => lerRascunho(draftKey) || initial)
  const [erro, setErro] = useState(false)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  // #63 · ditado por voz
  const [suporta, setSuporta] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef<RecLike | null>(null)

  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => { salvarRascunho(draftKey, texto) }, [draftKey, texto])
  useEffect(() => { setSuporta(!!getRecCtor()); return () => { recRef.current?.stop() } }, [])

  const gravar = useCallback(() => {
    if (gravando) { recRef.current?.stop(); return }
    const Ctor = getRecCtor(); if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true
    rec.onresult = (e) => {
      let fin = '', intr = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) fin += r[0].transcript; else intr += r[0].transcript
      }
      // transcrição final cai no textarea (editável); interim é só dica ao vivo
      if (fin) { setTexto((p) => (p ? p.trimEnd() + ' ' : '') + fin.trim()); if (erro) setErro(false) }
      setInterim(intr)
    }
    rec.onerror = () => { setGravando(false); setInterim('') }
    rec.onend = () => { setGravando(false); setInterim('') }
    recRef.current = rec
    rec.start(); setGravando(true)
  }, [gravando, erro])

  const enviar = async () => {
    if (gravando) { recRef.current?.stop() }
    if (obrigatorio && !texto.trim()) { setErro(true); ref.current?.focus(); return }
    await onSubmit(texto.trim())
    salvarRascunho(draftKey, '') // só limpa o rascunho quando envia de fato
  }

  return (
    <div style={{ marginTop: 8, background: '#FFFDF8', border: '1px solid #E7DED3', borderRadius: 10, padding: 10 }}>
      <textarea
        ref={ref}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); if (erro) setErro(false) }}
        placeholder={placeholder}
        rows={4}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 72,
          fontSize: 13, lineHeight: 1.45, color: '#3D2314', padding: '9px 11px',
          borderRadius: 8, border: `1px solid ${erro ? '#EF4444' : gravando ? '#C8941A' : '#E7DED3'}`, background: '#fff', fontFamily: 'inherit',
        }}
      />
      {gravando && <div style={{ fontSize: 11, color: '#C8941A', marginTop: 3 }}>🎙️ ouvindo… {interim && <span style={{ color: '#918C82', fontStyle: 'italic' }}>{interim}</span>}</div>}
      {erro && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>Escreva (ou dite) algo antes de enviar.</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void enviar()} disabled={busy}
          style={{ background: busy ? '#B9A98F' : '#C8941A', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'Enviando…' : submitLabel}
        </button>
        {suporta && (
          <button type="button" onClick={gravar} disabled={busy} title={gravando ? 'Parar de gravar' : 'Ditar por voz (revise antes de enviar)'}
            style={{ background: gravando ? '#EF444415' : 'transparent', color: gravando ? '#EF4444' : '#7A6A57', border: `1px solid ${gravando ? '#EF4444' : '#E7DED3'}`, borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {gravando ? '■ parar' : '🎙️ ditar'}
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={busy}
          style={{ background: 'transparent', color: '#7A6A57', border: '1px solid #E7DED3', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          Cancelar
        </button>
        <span style={{ fontSize: 10.5, color: '#918C82' }}>rascunho salvo — trocar de janela não perde o texto</span>
      </div>
    </div>
  )
}
