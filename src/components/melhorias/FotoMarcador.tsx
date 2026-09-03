'use client'

// FotoMarcador — foto + marcação, UMA fonte de verdade (RD-52: não pode forkar).
// Usado no formulário de nova sugestão E no compositor de resposta do chamado (conversa). Antes a
// marcação vivia inline na tela de melhorias; ao virar conversa, a resposta também precisa de foto
// marcada. Duplicar a lógica de marcação seria dois lugares para consertar o mesmo bug de coordenada.
//
// Coordenadas RELATIVAS (0..1): a marcação acompanha a foto em qualquer tamanho de tela. seta = ponto
// (x,y). retangulo/circulo = CENTRO (x,y) + tamanho (w,h). É o texto de cada marca que faz a IA
// entender o apontamento ("botão de salvar não submete"), não só o desenho.

import { useCallback, useEffect, useRef, useState } from 'react'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }

export type Ferramenta = 'seta' | 'retangulo' | 'circulo'
export type Marca = { tipo: Ferramenta; x: number; y: number; w?: number; h?: number; texto?: string }
export type FotoSel = { file: File; marcas: Marca[] } | null

const FERRAMENTAS: [Ferramenta, string][] = [['seta', '➤ Seta'], ['retangulo', '▭ Retângulo'], ['circulo', '◯ Círculo']]

export default function FotoMarcador({ value, onChange, compact = false }: {
  value: FotoSel
  onChange: (v: FotoSel) => void
  compact?: boolean
}) {
  const marcas = value?.marcas ?? []
  const [tool, setTool] = useState<Ferramenta>('seta')
  const [draw, setDraw] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const textoRefs = useRef<Record<number, HTMLInputElement | null>>({})

  // preview segue o arquivo do value (cria/revoga o object URL no ciclo certo). O object URL precisa
  // de um efeito de verdade (criar/revogar é sincronizar com uma API do browser) — daí o disable.
  useEffect(() => {
    const url = value?.file ? URL.createObjectURL(value.file) : null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url)
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [value?.file])

  const escolherFoto = useCallback((fl: File | null) => {
    setDraw(null)
    onChange(fl ? { file: fl, marcas: [] } : null)
  }, [onChange])

  const setMarcas = useCallback((updater: (m: Marca[]) => Marca[]) => {
    if (!value?.file) return
    onChange({ file: value.file, marcas: updater(value.marcas ?? []) })
  }, [onChange, value])

  // COLAR (Ctrl+V) dentro da área: pega a primeira imagem do clipboard.
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'))
    if (!item) return
    const blob = item.getAsFile()
    if (!blob) return
    e.preventDefault()
    const ext = (blob.type.split('/')[1] || 'png').split('+')[0]
    escolherFoto(new File([blob], `print-${Date.now()}.${ext}`, { type: blob.type }))
  }, [escolherFoto])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const fl = Array.from(e.dataTransfer?.files || []).find((x) => x.type.startsWith('image/'))
    if (fl) escolherFoto(fl)
  }, [escolherFoto])

  function pct(e: React.PointerEvent) {
    const img = imgRef.current; if (!img) return { x: 0, y: 0 }
    const r = img.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }
  function onPointerDown(e: React.PointerEvent) { e.preventDefault(); const p = pct(e); setDraw({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }) }
  function onPointerMove(e: React.PointerEvent) { if (!draw || tool === 'seta') return; const p = pct(e); setDraw((d) => (d ? { ...d, x1: p.x, y1: p.y } : d)) }
  function onPointerUp(e: React.PointerEvent) {
    if (!draw) return
    const p = pct(e)
    const dx = Math.abs(p.x - draw.x0), dy = Math.abs(p.y - draw.y0)
    let nova: Marca
    if (tool === 'seta' || (dx < 0.02 && dy < 0.02)) {
      nova = { tipo: tool, x: p.x, y: p.y, ...(tool !== 'seta' ? { w: 0.12, h: 0.12 } : {}) }
    } else {
      nova = { tipo: tool, x: (draw.x0 + p.x) / 2, y: (draw.y0 + p.y) / 2, w: dx, h: dy }
    }
    setDraw(null)
    const idx = marcas.length
    setTimeout(() => textoRefs.current[idx]?.focus(), 30)
    setMarcas((m) => [...m, nova])
  }

  const previewBox = draw && tool !== 'seta'
    ? { left: `${Math.min(draw.x0, draw.x1) * 100}%`, top: `${Math.min(draw.y0, draw.y1) * 100}%`, width: `${Math.abs(draw.x1 - draw.x0) * 100}%`, height: `${Math.abs(draw.y1 - draw.y0) * 100}%` }
    : null

  return (
    <div onPaste={onPaste}>
      {!preview && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{ border: `1.5px dashed ${dragOver ? C.gold : C.border}`, background: dragOver ? C.amberBg : C.cream, borderRadius: 10, padding: compact ? '10px 12px' : '16px 14px', textAlign: 'center', transition: 'all .12s' }}
        >
          <div style={{ fontSize: compact ? 12 : 13, color: C.espM, fontWeight: 600 }}>Cole um print com <b style={{ color: C.esp }}>Ctrl+V</b>, arraste a imagem aqui</div>
          {!compact && <div style={{ fontSize: 11.5, color: C.espL, margin: '3px 0 10px' }}>ou escolha do dispositivo</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: compact ? 8 : 0 }}>
            <label style={{ ...inp, cursor: 'pointer', fontWeight: 600, color: C.esp }}>
              🖼️ Escolher arquivo
              <input type="file" accept="image/*" onChange={(e) => escolherFoto(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
            </label>
            {/* Câmera no celular: capture=environment abre a câmera traseira direto */}
            <label style={{ ...inp, cursor: 'pointer', fontWeight: 600, color: C.esp }}>
              📷 Tirar foto
              <input type="file" accept="image/*" capture="environment" onChange={(e) => escolherFoto(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
      )}

      {preview && (
        <div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 11.5, color: C.espM, fontWeight: 600 }}>Marcar com:</span>
            {FERRAMENTAS.map(([t, label]) => (
              <button key={t} type="button" onClick={() => setTool(t)}
                style={{ fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${tool === t ? C.gold : C.border}`, background: tool === t ? C.amberBg : C.white, color: tool === t ? C.amber : C.espM }}>
                {label}
              </button>
            ))}
            <span style={{ fontSize: 11, color: C.espL, marginLeft: 'auto' }}>
              {tool === 'seta' ? 'toque onde está o problema' : 'arraste sobre a área'} · {marcas.length} marcação(ões)
              {marcas.length > 0 && <button type="button" onClick={() => setMarcas(() => [])} style={{ marginLeft: 6, border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontSize: 11 }}>limpar</button>}
            </span>
            <button type="button" onClick={() => escolherFoto(null)} style={{ border: 'none', background: 'none', color: C.espL, cursor: 'pointer', fontSize: 11 }}>trocar imagem</button>
          </div>

          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', userSelect: 'none' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={preview} alt="" draggable={false}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              style={{ maxWidth: '100%', maxHeight: compact ? 320 : 460, borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'crosshair', display: 'block', touchAction: 'none' }} />
            {marcas.map((m, i) => {
              if (m.tipo === 'seta') {
                return (
                  <div key={i} title={m.texto} style={{ position: 'absolute', left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: 'translate(-50%,-50%)', width: 24, height: 24, borderRadius: 999, background: 'rgba(180,35,24,0.9)', color: C.white, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', pointerEvents: 'none' }}>{i + 1}</div>
                )
              }
              const w = (m.w ?? 0.1), h = (m.h ?? 0.1)
              return (
                <div key={i} title={m.texto} style={{ position: 'absolute', left: `${(m.x - w / 2) * 100}%`, top: `${(m.y - h / 2) * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, border: `2.5px solid ${C.red}`, borderRadius: m.tipo === 'circulo' ? '50%' : 6, boxShadow: '0 0 0 1.5px #fff', pointerEvents: 'none' }}>
                  <span style={{ position: 'absolute', top: -11, left: -8, width: 20, height: 20, borderRadius: 999, background: C.red, color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>{i + 1}</span>
                </div>
              )
            })}
            {previewBox && (
              <div style={{ position: 'absolute', ...previewBox, border: `2px dashed ${C.red}`, borderRadius: tool === 'circulo' ? '50%' : 6, pointerEvents: 'none' }} />
            )}
          </div>

          {marcas.length > 0 && (
            <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              {marcas.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 999, background: C.red, color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <input
                    ref={(el) => { textoRefs.current[i] = el }}
                    value={m.texto ?? ''}
                    onChange={(e) => setMarcas((arr) => arr.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))}
                    placeholder="o que há de errado aqui? (ex.: botão de salvar não submete)"
                    style={{ ...inp, flex: 1 }} />
                  <button type="button" onClick={() => setMarcas((arr) => arr.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', color: C.espL, cursor: 'pointer', fontSize: 16, lineHeight: 1 }} title="remover marcação">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
