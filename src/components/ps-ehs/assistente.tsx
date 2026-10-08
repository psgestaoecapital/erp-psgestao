'use client'

import { useState, type ReactNode } from 'react'
import { EHS } from './tokens'
import { tEhs, type EhsIdioma } from './i18n'

export type EhsPasso = { id: string; titulo: string; conteudo: ReactNode }

/** Assistente passo a passo com a prévia do documento ao lado (D.6). */
export function EhsAssistente({ passos, previa, idioma = 'pt', onConcluir }: {
  passos: EhsPasso[]
  previa: ReactNode
  idioma?: EhsIdioma
  onConcluir?: () => void
}) {
  const [i, setI] = useState(0)
  const ultimo = i === passos.length - 1
  const passo = passos[i]
  if (!passo) return null
  const btn = { minHeight: 44, padding: '0 18px', borderRadius: 10, fontWeight: 600, cursor: 'pointer' } as const
  return (
    <div data-testid="ehs-assistente" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
      <section aria-live="polite">
        <p data-testid="ehs-assistente-passo" style={{ fontSize: 12, color: EHS.suave, margin: '0 0 4px' }}>
          {tEhs('passo.de', idioma)} {i + 1}/{passos.length}
        </p>
        <h2 style={{ fontSize: 22, margin: '0 0 12px', color: EHS.tinta }}>{passo.titulo}</h2>
        <div>{passo.conteudo}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} style={{ ...btn, background: EHS.superficie, border: `1px solid ${EHS.borda}`, color: EHS.tinta }}>
            {tEhs('passo.voltar', idioma)}
          </button>
          <button type="button" onClick={() => (ultimo ? onConcluir?.() : setI(i + 1))} style={{ ...btn, background: EHS.marca, border: 'none', color: '#fff' }}>
            {tEhs(ultimo ? 'passo.concluir' : 'passo.avancar', idioma)}
          </button>
        </div>
      </section>
      <aside data-testid="ehs-assistente-previa" aria-label={tEhs('passo.previa', idioma)} style={{ background: EHS.superficie, border: `1px solid ${EHS.borda}`, borderRadius: 12, padding: 18 }}>
        <p style={{ fontSize: 12, color: EHS.suave, margin: '0 0 8px' }}>{tEhs('passo.previa', idioma)}</p>
        {previa}
      </aside>
    </div>
  )
}
