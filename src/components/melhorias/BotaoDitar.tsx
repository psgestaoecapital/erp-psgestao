'use client'
// #63 (Jordana) · "enviar as sugestões por áudio ao invés de texto digitado".
// Botão de DITADO por voz reutilizável — Web Speech API, client-side, pt-BR, GRÁTIS, sem chamada de
// servidor e sem guardar áudio (mesmo padrão já usado no RespostaInline/VozSoap). A transcrição cai no
// campo de texto e fica EDITÁVEL: a pessoa confere e ajusta antes de enviar (nunca envia às cegas · RD-51).
// Navegador sem suporte → o botão some, só digita (fallback honesto). Não é gravação de áudio para alguém
// ouvir — é fala→texto na hora; guardar o blob de áudio seria outro desenho (anexo novo), não foi pedido.
import { useCallback, useEffect, useRef, useState } from 'react'

// Web Speech API não está no lib.dom estável entre navegadores — tipos mínimos.
type RecResultAlt = { transcript: string }
type RecResult = ArrayLike<RecResultAlt> & { isFinal: boolean }
type RecEvent = { resultIndex: number; results: ArrayLike<RecResult> }
type RecLike = {
  lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void
  onresult: ((e: RecEvent) => void) | null; onerror: (() => void) | null; onend: (() => void) | null
}
type RecCtor = new () => RecLike
function getRecCtor(): RecCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function BotaoDitar({ onTexto, disabled = false }: {
  // recebe cada trecho FINAL transcrito (o pai decide como anexar ao campo)
  onTexto: (fragmento: string) => void
  disabled?: boolean
}) {
  const [suporta, setSuporta] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef<RecLike | null>(null)

  // deteta suporte só no cliente (window). setState no efeito é intencional aqui (1x no mount).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSuporta(!!getRecCtor()); return () => { recRef.current?.stop() } }, [])

  const gravar = useCallback(() => {
    if (gravando) { recRef.current?.stop(); return }
    const Ctor = getRecCtor(); if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true
    rec.onresult = (e) => {
      let fin = ''; let intr = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) fin += r[0].transcript; else intr += r[0].transcript
      }
      if (fin.trim()) onTexto(fin.trim())
      setInterim(intr)
    }
    rec.onerror = () => { setGravando(false); setInterim('') }
    rec.onend = () => { setGravando(false); setInterim('') }
    recRef.current = rec
    rec.start(); setGravando(true)
  }, [gravando, onTexto])

  if (!suporta) return null

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={gravar}
        disabled={disabled}
        title={gravando ? 'Parar de gravar' : 'Ditar por voz (revise o texto antes de enviar)'}
        style={{
          background: gravando ? '#EF444415' : 'transparent',
          color: gravando ? '#EF4444' : '#7A6A57',
          border: `1px solid ${gravando ? '#EF4444' : '#E7DED3'}`,
          borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600,
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        {gravando ? '■ parar' : '🎙️ ditar'}
      </button>
      {gravando && (
        <span style={{ fontSize: 11, color: '#C8941A' }}>
          ouvindo… {interim && <span style={{ color: '#918C82', fontStyle: 'italic' }}>{interim}</span>}
        </span>
      )}
    </span>
  )
}
