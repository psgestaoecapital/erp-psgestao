// src/app/dashboard/compliance/epi/_components/CanvasAssinatura.tsx
// Canvas de assinatura eletronica (NR-6 + Lei 14.063/2020).
// Mobile-first com touch-action: none para suportar dedo + Apple Pencil + S-Pen.

'use client'

import { useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'

interface Props {
  onChange: (data: { svg: string; base64: string; isEmpty: boolean }) => void
  height?: number
}

export function CanvasAssinatura({ onChange, height = 200 }: Props) {
  const sigRef = useRef<SignatureCanvas>(null)
  const [hasSignature, setHasSignature] = useState(false)

  function handleEnd() {
    if (!sigRef.current) return
    const isEmpty = sigRef.current.isEmpty()
    setHasSignature(!isEmpty)

    if (isEmpty) {
      onChange({ svg: '', base64: '', isEmpty: true })
      return
    }

    const base64 = sigRef.current.toDataURL('image/png')
    const canvas = sigRef.current.getCanvas()
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><image href="${base64}" /></svg>`

    onChange({ svg, base64, isEmpty: false })
  }

  function handleClear() {
    sigRef.current?.clear()
    setHasSignature(false)
    onChange({ svg: '', base64: '', isEmpty: true })
  }

  return (
    <div>
      <div
        style={{
          border: '2px solid rgba(61,35,20,0.30)',
          borderRadius: 10,
          background: '#FFFFFF',
          padding: 8,
          position: 'relative',
          touchAction: 'none',
        }}
      >
        <SignatureCanvas
          ref={sigRef}
          canvasProps={{
            style: {
              width: '100%',
              height: `${height}px`,
              touchAction: 'none',
              display: 'block',
            },
          }}
          penColor="#3D2314"
          minWidth={1.5}
          maxWidth={3}
          velocityFilterWeight={0.7}
          onEnd={handleEnd}
        />

        {!hasSignature && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div style={{ textAlign: 'center', color: 'rgba(61,35,20,0.40)' }}>
              <div style={{ fontSize: 32, marginBottom: 4 }}>✍️</div>
              <div style={{ fontSize: 13 }}>Assine no quadro acima</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.60)', margin: 0 }}>
          {hasSignature ? '✓ Assinatura capturada' : 'Aguardando assinatura...'}
        </p>
        <button
          type="button"
          onClick={handleClear}
          disabled={!hasSignature}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: 'transparent',
            color: '#3D2314',
            border: 'none',
            cursor: hasSignature ? 'pointer' : 'not-allowed',
            opacity: hasSignature ? 1 : 0.3,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          🗑️ Limpar
        </button>
      </div>
    </div>
  )
}
