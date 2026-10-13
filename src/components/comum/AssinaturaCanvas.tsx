'use client'

// FEAT-OS-ONDA4-O43-ASSINATURA-v1
// Canvas nativo de assinatura · Pointer Events (mouse + touch + stylus)
// touch-action: none pra evitar scroll durante o traco.
// API: forwardRef expõe { toDataURL(), clear(), isEmpty() }.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export interface AssinaturaCanvasHandle {
  toDataURL: () => string
  clear: () => void
  isEmpty: () => boolean
}

interface Props {
  height?: number
  borderColor?: string
  bg?: string
  ink?: string
}

const AssinaturaCanvas = forwardRef<AssinaturaCanvasHandle, Props>(function AssinaturaCanvas(
  { height = 150, borderColor = '#3D2314', bg = '#FFFFFF', ink = '#3D2314' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const dirtyRef = useRef(false)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)

  // Ajusta tamanho do canvas pra DPR · redesenha BG branco
  function resize() {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width = Math.max(1, Math.round(rect.width * dpr))
    c.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.strokeStyle = ink
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  useEffect(() => {
    resize()
    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pointFromEvent(e: PointerEvent): { x: number; y: number } | null {
    const c = canvasRef.current
    if (!c) return null
    const rect = c.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current
    if (!c) return
    c.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const pt = pointFromEvent(e.nativeEvent)
    lastPtRef.current = pt
    if (pt) {
      const ctx = c.getContext('2d')
      if (ctx) { ctx.beginPath(); ctx.moveTo(pt.x, pt.y) }
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const c = canvasRef.current
    if (!c) return
    const pt = pointFromEvent(e.nativeEvent)
    const last = lastPtRef.current
    if (!pt || !last) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(pt.x, pt.y)
    lastPtRef.current = pt
    dirtyRef.current = true
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false
    lastPtRef.current = null
    try { canvasRef.current?.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  useImperativeHandle(ref, () => ({
    toDataURL: () => canvasRef.current?.toDataURL('image/png') ?? '',
    clear: () => {
      dirtyRef.current = false
      resize()
    },
    isEmpty: () => !dirtyRef.current,
  }))

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      data-testid="os-assinar-canvas"
      style={{
        display: 'block',
        width: '100%',
        height,
        background: bg,
        border: `2px dashed ${borderColor}`,
        borderRadius: 8,
        touchAction: 'none',
        cursor: 'crosshair',
      }}
    />
  )
})

export default AssinaturaCanvas
