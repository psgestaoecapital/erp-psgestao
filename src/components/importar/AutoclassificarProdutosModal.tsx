'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import AutoclassificarProdutosCard from './AutoclassificarProdutosCard'

interface Props {
  companyId: string
  onClose: () => void
  onAtualizado?: () => void
}

export default function AutoclassificarProdutosModal({ companyId, onClose, onAtualizado }: Props) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 16px', zIndex: 50, overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FAF7F2', borderRadius: 12, width: '100%', maxWidth: 1100,
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)', position: 'relative',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid rgba(61,35,20,0.12)',
          background: '#3D2314', borderRadius: '12px 12px 0 0',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#C8941A', margin: 0, fontFamily: 'Fraunces, Georgia, serif' }}>
            🤖 Auto-classificar produtos pela base PS
          </h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            style={{
              background: 'transparent', border: 'none', color: '#FAF7F2',
              cursor: 'pointer', padding: 6, display: 'flex', minWidth: 44, minHeight: 44,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 16 }}>
          <AutoclassificarProdutosCard companyId={companyId} onAplicado={onAtualizado} />
        </div>
      </div>
    </div>
  )
}
