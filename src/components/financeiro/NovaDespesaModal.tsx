'use client'

import NovaDespesaForm from './NovaDespesaForm'

interface NovaDespesaModalProps {
  companyId: string
  aberto: boolean
  onFechar: () => void
  onSucesso?: (despesaId: string) => void
}

export default function NovaDespesaModal({
  companyId,
  aberto,
  onFechar,
  onSucesso,
}: NovaDespesaModalProps) {
  if (!aberto) return null

  return (
    <div
      onClick={onFechar}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(61,35,20,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '32px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFFFF',
          borderRadius: 12,
          maxWidth: 800,
          width: '100%',
          maxHeight: 'calc(100vh - 64px)',
          overflowY: 'auto',
        }}
      >
        <NovaDespesaForm
          companyId={companyId}
          onSucesso={(id) => {
            onSucesso?.(id)
            onFechar()
          }}
          onCancelar={onFechar}
        />
      </div>
    </div>
  )
}
