'use client'

import type { ReactNode } from 'react'
import { EHS, type EhsStatus } from './tokens'
import { tEhs, type EhsIdioma } from './i18n'

const COR: Record<EhsStatus, { fg: string; bg: string }> = {
  ok: { fg: EHS.ok, bg: EHS.okBg },
  atencao: { fg: EHS.atencao, bg: EHS.atencaoBg },
  critico: { fg: EHS.critico, bg: EHS.criticoBg },
  neutro: { fg: EHS.neutro, bg: EHS.neutroBg },
}

/** Cabeçalho padrão das telas PS EHS. */
export function EhsCabecalho({ titulo, descricao, idioma = 'pt', acoes }: {
  titulo: string
  descricao?: string
  idioma?: EhsIdioma
  acoes?: ReactNode
}) {
  return (
    <header data-testid="ehs-cabecalho" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
      <div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: EHS.marca }}>
          {tEhs('ehs.nome', idioma)} · {tEhs('ehs.subtitulo', idioma)}
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 600, margin: '4px 0 6px', color: EHS.tinta }}>{titulo}</h1>
        {descricao && <p style={{ margin: 0, fontSize: 14, color: EHS.suave }}>{descricao}</p>}
      </div>
      {acoes}
    </header>
  )
}

/** Cartão de status: a cor aparece só no indicador de status. */
export function EhsCartaoStatus({ rotulo, valor, status, detalhe }: {
  rotulo: string
  valor: ReactNode
  status: EhsStatus
  detalhe?: string
}) {
  const c = COR[status]
  return (
    <div data-testid="ehs-cartao-status" data-status={status} style={{ background: EHS.superficie, border: `1px solid ${EHS.borda}`, borderLeft: `6px solid ${c.fg}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: EHS.suave, fontWeight: 600 }}>{rotulo}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: EHS.tinta, lineHeight: 1.2 }}>{valor}</div>
      {detalhe && <div style={{ fontSize: 12, color: c.fg, background: c.bg, display: 'inline-block', padding: '2px 8px', borderRadius: 999, marginTop: 6 }}>{detalhe}</div>}
    </div>
  )
}

export type EhsEventoLinha = { quando: string; titulo: string; status?: EhsStatus }

/** Linha do tempo da ficha viva. */
export function EhsLinhaDoTempo({ eventos, idioma = 'pt' }: { eventos: EhsEventoLinha[]; idioma?: EhsIdioma }) {
  return (
    <section data-testid="ehs-linha-do-tempo" aria-label={tEhs('timeline.titulo', idioma)}>
      <h2 style={{ fontSize: 14, margin: '0 0 8px', color: EHS.suave }}>{tEhs('timeline.titulo', idioma)}</h2>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: `2px solid ${EHS.borda}` }}>
        {eventos.map((e, i) => (
          <li key={i} style={{ padding: '6px 0 6px 14px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: -6, top: 12, width: 10, height: 10, borderRadius: 999, background: COR[e.status ?? 'neutro'].fg }} />
            <div style={{ fontSize: 11, color: EHS.suave }}>{e.quando}</div>
            <div style={{ fontSize: 14, color: EHS.tinta }}>{e.titulo}</div>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Botão grande para uso em campo (alto contraste, alvo ≥ 56px). */
export function EhsBotaoCampo({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ minHeight: EHS.alvoToque, minWidth: EHS.alvoToque, padding: '0 20px', fontSize: 18, fontWeight: 700, background: EHS.marca, color: '#fff', border: 'none', borderRadius: 14, cursor: 'pointer' }}>
      {children}
    </button>
  )
}
