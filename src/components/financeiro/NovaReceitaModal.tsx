'use client'

import NovaReceitaForm from './NovaReceitaForm'

interface NovaReceitaModalProps {
  companyId: string
  aberto: boolean
  onFechar: () => void
  onSucesso?: (receitaId: string) => void
  initial?: { clienteId?: string; clienteNome?: string; valor?: string; descricao?: string }
}

export default function NovaReceitaModal({
  companyId,
  aberto,
  onFechar,
  onSucesso,
  initial,
}: NovaReceitaModalProps) {
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
        <NovaReceitaForm
          companyId={companyId}
          initial={initial}
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
