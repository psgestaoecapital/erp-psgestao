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

export type EhsPasso = { titulo: string; conteudo: ReactNode }

/** Assistente passo a passo com prévia do documento ao lado (empilha no celular). */
export function EhsAssistente({ passos, passoAtual, onMudar, previa, idioma = 'pt' }: {
  passos: EhsPasso[]
  passoAtual: number
  onMudar: (i: number) => void
  previa: ReactNode
  idioma?: EhsIdioma
}) {
  const p = passos[passoAtual]
  if (!p) return null
  return (
    <div data-testid="ehs-assistente" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <section style={{ flex: '1 1 340px', minWidth: 0 }}>
        <p data-testid="ehs-assistente-passo" style={{ margin: 0, fontSize: 12, fontWeight: 700, color: EHS.marca }}>
          {tEhs('passo.de', idioma)} {passoAtual + 1}/{passos.length}
        </p>
        <h2 style={{ fontSize: 22, margin: '4px 0 12px', color: EHS.tinta }}>{p.titulo}</h2>
        {p.conteudo}
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button type="button" disabled={passoAtual === 0} onClick={() => onMudar(passoAtual - 1)}
            style={{ minHeight: EHS.alvoToque, padding: '0 20px', fontSize: 16, borderRadius: 14, border: `1px solid ${EHS.borda}`, background: EHS.superficie, color: EHS.tinta }}>
            {tEhs('passo.voltar', idioma)}
          </button>
          <button type="button" disabled={passoAtual === passos.length - 1} onClick={() => onMudar(passoAtual + 1)}
            style={{ minHeight: EHS.alvoToque, padding: '0 20px', fontSize: 16, fontWeight: 700, borderRadius: 14, border: 'none', background: EHS.marca, color: '#fff' }}>
            {tEhs('passo.avancar', idioma)}
          </button>
        </div>
      </section>
      <aside data-testid="ehs-assistente-previa" aria-label={tEhs('passo.previa', idioma)}
        style={{ flex: '1 1 300px', minWidth: 0, background: EHS.superficie, border: `1px solid ${EHS.borda}`, borderRadius: 12, padding: 18 }}>
        <h3 style={{ fontSize: 12, margin: '0 0 8px', color: EHS.suave, textTransform: 'uppercase', letterSpacing: 1 }}>{tEhs('passo.previa', idioma)}</h3>
        {previa}
      </aside>
    </div>
  )
}

/** Painel lateral de edição: edita sem sair da tela. */
export function EhsPainelLateral({ aberto, titulo, onFechar, children, idioma = 'pt' }: {
  aberto: boolean
  titulo: string
  onFechar: () => void
  children: ReactNode
  idioma?: EhsIdioma
}) {
  if (!aberto) return null
  return (
    <div data-testid="ehs-painel-lateral" role="dialog" aria-modal="true" aria-label={titulo}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 100vw)', background: EHS.superficie, borderLeft: `1px solid ${EHS.borda}`, boxShadow: '-8px 0 24px rgba(20,33,28,.12)', padding: 24, overflowY: 'auto', zIndex: 60 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, margin: 0, color: EHS.tinta }}>{titulo}</h2>
        <button type="button" onClick={onFechar} aria-label={tEhs('painel.fechar', idioma)}
          style={{ minHeight: 44, minWidth: 44, border: `1px solid ${EHS.borda}`, borderRadius: 10, background: EHS.superficie, fontSize: 18 }}>×</button>
      </div>
      {children}
    </div>
  )
}

/** Ficha viva: dados à esquerda, linha do tempo à direita. */
export function EhsFichaViva({ titulo, status, dados, eventos, idioma = 'pt' }: {
  titulo: string
  status: EhsStatus
  dados: { rotulo: string; valor: ReactNode }[]
  eventos: EhsEventoLinha[]
  idioma?: EhsIdioma
}) {
  return (
    <div data-testid="ehs-ficha-viva" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <section style={{ flex: '2 1 320px', minWidth: 0 }}>
        <h2 style={{ fontSize: 22, margin: '0 0 4px', color: EHS.tinta }}>{titulo}</h2>
        <span style={{ fontSize: 12, color: COR[status].fg, background: COR[status].bg, padding: '2px 10px', borderRadius: 999 }}>{tEhs(`status.${status}`, idioma)}</span>
        <dl style={{ margin: '16px 0 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {dados.map((d, i) => (
            <div key={i}><dt style={{ fontSize: 12, color: EHS.suave }}>{d.rotulo}</dt><dd style={{ margin: 0, fontSize: 15, color: EHS.tinta }}>{d.valor}</dd></div>
          ))}
        </dl>
      </section>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}><EhsLinhaDoTempo eventos={eventos} idioma={idioma} /></div>
    </div>
  )
}
