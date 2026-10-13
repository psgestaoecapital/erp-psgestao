'use client'
// IA-1.3 · Voz → Prontuário SOAP. O dentista fala; o navegador transcreve (Web Speech API, pt-BR, grátis,
// client-side) e mostra ao vivo; o texto bruto fica editável; "Estruturar em SOAP" manda pro /api/odonto/
// voz-soap (aiGuardedCall feature 'voz_soap' · toggle+metering por clínica). Fallbacks honestos (RD-51):
// navegador sem suporte → só digita; feature desligada → o 🎙️ some; budget/curto → não chama, edita o bruto.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { TOK } from './ui'
import { Mic, Square, Sparkles } from 'lucide-react'

export type SoapCampos = { s: string; o: string; a: string; p: string }

// tipos mínimos da Web Speech API (não vêm no lib.dom padrão de forma estável entre navegadores)
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

export function VozSoap({ companyId, onEstruturado }: { companyId: string; onEstruturado: (soap: SoapCampos, dentes: string[]) => void }) {
  const [suporta, setSuporta] = useState(false)
  const [habilitada, setHabilitada] = useState<boolean | null>(null)   // null = ainda checando (não pisca)
  const [gravando, setGravando] = useState(false)
  const [bruto, setBruto] = useState('')
  const [interim, setInterim] = useState('')
  const [estruturando, setEstruturando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const recRef = useRef<RecLike | null>(null)

  // suporte do navegador + toggle da clínica (DEFAULT ON: ausência de linha = ligada)
  useEffect(() => {
    setSuporta(!!getRecCtor())
    let alive = true
    void supabase.rpc('fn_ia_empresa_config', { p_company_id: companyId }).then(({ data }) => {
      if (!alive) return
      const rows = (data as { feature: string; habilitado: boolean }[] | null) ?? []
      const row = rows.find((r) => r.feature === 'voz_soap')
      setHabilitada(row ? row.habilitado : true)
    })
    return () => { alive = false; recRef.current?.stop() }
  }, [companyId])

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
      if (fin) setBruto((p) => (p ? p + ' ' : '') + fin.trim())
      setInterim(intr)
    }
    rec.onerror = () => { setGravando(false); setInterim('') }
    rec.onend = () => { setGravando(false); setInterim('') }
    recRef.current = rec
    setAviso(null); rec.start(); setGravando(true)
  }, [gravando])

  const estruturar = async () => {
    const txt = bruto.trim()
    if (txt.length < 12) { setAviso('Fale (ou escreva) um pouco mais para estruturar — ou digite direto nos campos abaixo.'); return }
    setEstruturando(true); setAviso(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setAviso('sessão expirada'); return }
      const res = await fetch('/api/odonto/voz-soap', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: companyId, texto_bruto: txt }),
      })
      const j = await res.json() as { ok?: boolean; soap?: SoapCampos; dentes?: string[]; aviso?: string; error?: string; ia_desativada?: boolean }
      if (j.ok && j.soap) {
        onEstruturado(j.soap, j.dentes ?? [])
        setAviso('Estruturado em SOAP. Revise os campos abaixo antes de assinar.')
        if (j.dentes && j.dentes.length) setAviso(`Estruturado em SOAP (dentes citados: ${j.dentes.join(', ')}). Revise antes de assinar.`)
      } else {
        if (j.ia_desativada) setHabilitada(false)
        setAviso(j.aviso || j.error || 'Não deu para estruturar agora. Ajuste o texto e tente de novo — ou digite nos campos.')
      }
    } catch { setAviso('falha de rede — o texto ficou aqui para você editar') } finally { setEstruturando(false) }
  }

  if (habilitada === false) return null   // clínica desligou voz_soap → o 🎙️ some (spec)
  if (habilitada === null) return null    // ainda checando → não pisca

  const box: React.CSSProperties = { border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: TOK.esp, resize: 'vertical', boxSizing: 'border-box', width: '100%' }

  return (
    <div style={{ background: 'linear-gradient(180deg, #FFFDF8, #FFFFFF)', border: `0.5px solid ${TOK.gold}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, color: TOK.gold, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <Sparkles size={14} /> Ditar evolução
        </div>
        {suporta ? (
          <button onClick={gravar} disabled={estruturando}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: estruturando ? 'not-allowed' : 'pointer', border: 'none',
              background: gravando ? TOK.red : TOK.gold, color: '#fff' }}>
            {gravando ? <><Square size={13} /> Parar</> : <><Mic size={14} /> Falar</>}
            {gravando && <span style={{ width: 7, height: 7, borderRadius: 999, background: '#fff', animation: 'pulseVoz 1s ease-in-out infinite' }} />}
          </button>
        ) : (
          <span style={{ fontSize: 11.5, color: TOK.mut }}>Ditado por voz não disponível neste navegador — digite abaixo.</span>
        )}
      </div>

      {(bruto || interim || suporta) && (
        <div style={{ marginTop: 8 }}>
          <textarea value={bruto + (interim ? (bruto ? ' ' : '') + interim : '')} onChange={(e) => { setBruto(e.target.value); setInterim('') }}
            placeholder={suporta ? 'Toque em Falar e dite o atendimento… (ex.: “paciente relatou dor no 26, fiz restauração oclusal em resina”). O texto aparece aqui e fica editável.' : 'Digite ou cole o relato do atendimento para estruturar em SOAP…'}
            rows={3} style={box} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: TOK.mut }}>Transcrição é do navegador (grátis). A estruturação em SOAP usa IA (custo por clínica).</span>
            <button onClick={() => void estruturar()} disabled={estruturando || bruto.trim().length < 12}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, border: `0.5px solid ${TOK.gold}`, background: '#fff', color: TOK.gold,
                cursor: (estruturando || bruto.trim().length < 12) ? 'not-allowed' : 'pointer', opacity: (estruturando || bruto.trim().length < 12) ? 0.5 : 1 }}>
              <Sparkles size={14} /> {estruturando ? 'Estruturando…' : 'Estruturar em SOAP'}
            </button>
          </div>
        </div>
      )}
      {aviso && <div style={{ fontSize: 11.5, color: TOK.esp, marginTop: 6 }}>{aviso}</div>}
      <style>{'@keyframes pulseVoz{0%,100%{opacity:1}50%{opacity:0.25}}'}</style>
    </div>
  )
}
