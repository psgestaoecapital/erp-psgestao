'use client'

import { useState, type ReactNode } from 'react'
import { EHS } from './tokens'
import { tEhs, type EhsIdioma } from './i18n'

export type EhsPasso = { id: string; titulo: string; conteudo: ReactNode }

/** Assistente passo a passo com a prévia do documento ao lado (D.6). */
export function EhsAssistente({ passos, previa, idioma = 'pt', onConcluir }: {
  passos: EhsPasso[]
  previa: (passoAtual: number) => ReactNode
  idioma?: EhsIdioma
  onConcluir?: () => void
}) {
  const [i, setI] = useState(0)
  const ultimo = i === passos.length - 1
  const passo = passos[i]
  if (!passo) return null
  return (
    <div data-testid="ehs-assistente" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
      <section style={{ background: EHS.superficie, border: `1px solid ${EHS.borda}`, borderRadius: 12, padding: 20 }}>
        <p data-testid="ehs-passo-indicador" style={{ margin: 0, fontSize: 12, color: EHS.suave }}>
          {tEhs('passo.de', idioma)} {i + 1}/{passos.length}
        </p>
        <h2 style={{ fontSize: 20, margin: '4px 0 12px', color: EHS.tinta }}>{passo.titulo}</h2>
        <div>{passo.conteudo}</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} style={{ minHeight: 48, padding: '0 18px', borderRadius: 10, border: `1px solid ${EHS.borda}`, background: EHS.superficie, color: EHS.tinta }}>
            {tEhs('passo.voltar', idioma)}
          </button>
          <button type="button" onClick={() => (ultimo ? onConcluir?.() : setI(i + 1))} style={{ minHeight: 48, padding: '0 22px', borderRadius: 10, border: 'none', background: EHS.marca, color: '#fff', fontWeight: 700 }}>
            {tEhs(ultimo ? 'passo.concluir' : 'passo.avancar', idioma)}
          </button>
        </div>
      </section>
      <aside aria-label={tEhs('passo.previa', idioma)} data-testid="ehs-previa" style={{ background: EHS.marcaClara, border: `1px solid ${EHS.borda}`, borderRadius: 12, padding: 20 }}>
        <h3 style={{ fontSize: 12, margin: '0 0 8px', color: EHS.suave, textTransform: 'uppercase', letterSpacing: 1 }}>{tEhs('passo.previa', idioma)}</h3>
        {previa(i)}
      </aside>
    </div>
  )
}

/** Painel lateral de edição: edita sem sair da tela de origem (D.6). */
export function EhsPainelLateral({ aberto, titulo, onFechar, children, idioma = 'pt' }: {
  aberto: boolean
  titulo: string
  onFechar: () => void
  children: ReactNode
  idioma?: EhsIdioma
}) {
  if (!aberto) return null
  return (
    <aside role="dialog" aria-label={titulo} data-testid="ehs-painel-lateral" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 100vw)', background: EHS.superficie, borderLeft: `1px solid ${EHS.borda}`, boxShadow: '-8px 0 24px rgba(0,0,0,.08)', padding: 20, overflowY: 'auto', zIndex: 50 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, margin: 0, color: EHS.tinta }}>{titulo}</h2>
        <button type="button" onClick={onFechar} style={{ minHeight: 40, padding: '0 14px', borderRadius: 8, border: `1px solid ${EHS.borda}`, background: EHS.superficie }}>{tEhs('painel.fechar', idioma)}</button>
      </div>
      {children}
    </aside>
  )
}
