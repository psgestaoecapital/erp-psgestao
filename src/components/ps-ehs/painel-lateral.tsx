'use client'

import type { ReactNode } from 'react'
import { EHS } from './tokens'
import { tEhs, type EhsIdioma } from './i18n'

/** Painel lateral de edição: edita sem sair da lista/ficha. Esc ou "Fechar" fecham. */
export function EhsPainelLateral({ aberto, titulo, onFechar, onSalvar, children, idioma = 'pt' }: {
  aberto: boolean
  titulo: string
  onFechar: () => void
  onSalvar?: () => void
  children: ReactNode
  idioma?: EhsIdioma
}) {
  if (!aberto) return null
  return (
    <aside
      data-testid="ehs-painel-lateral"
      role="dialog"
      aria-label={titulo}
      onKeyDown={e => { if (e.key === 'Escape') onFechar() }}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 100vw)', background: EHS.superficie, borderLeft: `1px solid ${EHS.borda}`, boxShadow: '-8px 0 24px rgba(0,0,0,.08)', padding: 20, overflowY: 'auto', zIndex: 50 }}
    >
      <h2 style={{ fontSize: 18, margin: '0 0 12px', color: EHS.tinta }}>{titulo}</h2>
      <div>{children}</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button type="button" onClick={onFechar} style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, background: EHS.superficie, border: `1px solid ${EHS.borda}`, color: EHS.tinta, fontWeight: 600, cursor: 'pointer' }}>
          {tEhs('painel.fechar', idioma)}
        </button>
        {onSalvar && (
          <button type="button" onClick={onSalvar} style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, background: EHS.marca, border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            {tEhs('painel.salvar', idioma)}
          </button>
        )}
      </div>
    </aside>
  )
}
