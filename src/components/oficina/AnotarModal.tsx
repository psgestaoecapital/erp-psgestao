'use client'
// DVI (Onda 2) · editor de anotação. O mecânico desenha por cima da foto (círcula a peça gasta,
// seta no vazamento) e salva. Vetorial: nunca queima na imagem — grava em erp_os_registro_foto.anotacao
// via fn_os_foto_anotar. Pontos normalizados 0..1 pela caixa da imagem (mesmo render do AnotacaoOverlay).
import { useRef, useState } from 'react'
import { X, Undo2, Eraser, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { CORES_ANOTACAO, parseTracos, type Traco, type Ponto } from './anotacao'

const ESP = '#3D2314', LINE = '#E7DECF', OK = '#166534'
const clamp = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

export default function AnotarModal({ fotoId, url, anotacaoInicial, onFechar, onSalvo }: {
  fotoId: string
  url: string | null
  anotacaoInicial?: unknown
  onFechar: () => void
  onSalvo: () => void
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const desenhando = useRef(false)
  const [tracos, setTracos] = useState<Traco[]>(() => parseTracos(anotacaoInicial))
  const [cor, setCor] = useState<string>(CORES_ANOTACAO[0])
  const [salvando, setSalvando] = useState(false)

  const ponto = (e: React.PointerEvent): Ponto => {
    const b = boxRef.current?.getBoundingClientRect()
    if (!b || b.width === 0) return [0, 0]
    return [clamp((e.clientX - b.left) / b.width), clamp((e.clientY - b.top) / b.height)]
  }
  const start = (e: React.PointerEvent) => {
    e.preventDefault(); desenhando.current = true
    const p = ponto(e); setTracos((t) => [...t, { cor, pontos: [p] }])
  }
  const move = (e: React.PointerEvent) => {
    if (!desenhando.current) return
    e.preventDefault(); const p = ponto(e)
    setTracos((t) => { if (t.length === 0) return t; const last = t[t.length - 1]; return [...t.slice(0, -1), { ...last, pontos: [...last.pontos, p] }] })
  }
  const end = () => { desenhando.current = false }
  const desfazer = () => setTracos((t) => t.slice(0, -1))
  const limpar = () => setTracos([])

  const salvar = async () => {
    if (salvando) return
    setSalvando(true)
    const anot = tracos.length > 0 ? { v: 1, tracos } : null
    const { data, error } = await supabase.rpc('fn_os_foto_anotar', { p_id: fotoId, p_anotacao: anot })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) return   // silencioso: o modal fica aberto p/ tentar de novo
    onSalvo(); onFechar()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(0,0,0,0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 12, gap: 12 }}>
      <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, alignSelf: 'center' }}>Anote na foto — o cliente vê no orçamento</div>
      {/* wrapper shrink-wrap: a SVG (inset:0) casa exatamente com a imagem, em qualquer proporção */}
      <div ref={boxRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        style={{ position: 'relative', display: 'inline-block', lineHeight: 0, maxWidth: '94vw', maxHeight: '64vh', touchAction: 'none', cursor: 'crosshair' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt="foto para anotar" referrerPolicy="no-referrer" draggable={false}
          style={{ display: 'block', maxWidth: '94vw', maxHeight: '64vh', borderRadius: 8, userSelect: 'none' }} />}
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {tracos.map((t, i) => (
            <polyline key={i} points={t.pontos.map((p) => `${p[0]},${p[1]}`).join(' ')} fill="none"
              stroke={t.cor} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
      </div>
      {/* barra: cores + desfazer/limpar + salvar/fechar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {CORES_ANOTACAO.map((c) => (
            <button key={c} onClick={() => setCor(c)} aria-label={`cor ${c}`}
              style={{ width: 30, height: 30, borderRadius: 999, background: c, cursor: 'pointer',
                border: cor === c ? '3px solid #fff' : `1px solid ${LINE}`, boxShadow: cor === c ? '0 0 0 2px rgba(0,0,0,0.4)' : 'none' }} />
          ))}
        </div>
        <button onClick={desfazer} disabled={tracos.length === 0} style={btn}><Undo2 size={15} /> Desfazer</button>
        <button onClick={limpar} disabled={tracos.length === 0} style={btn}><Eraser size={15} /> Limpar</button>
        <button onClick={() => void salvar()} disabled={salvando} style={{ ...btn, background: OK, color: '#fff', border: 'none' }}>
          <Check size={15} /> {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={onFechar} style={{ ...btn, background: 'transparent', color: '#fff' }}><X size={15} /> Fechar</button>
      </div>
    </div>
  )
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 40, padding: '0 14px', borderRadius: 10,
  border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 13, fontWeight: 700, cursor: 'pointer',
}
