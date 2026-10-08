'use client'
// Design system PS EHS (D.6): Espresso na estrutura, Off-white no fundo, Dourado nos destaques;
// verde/amarelo/vermelho SÓ em status. Mobile primeiro: alvos de toque >= 48px, alto contraste.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { EHS_LANGS, type EhsLang } from '@/lib/ehs/i18n'

export const EHS = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', borderLt: '#ece3d2', ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.7)',
  verde: '#2d6a3e', verdeBg: '#e8f3ec', amarelo: '#8a6a10', amareloBg: '#fdf4e0',
  vermelho: '#a02020', vermelhoBg: '#fce8e8', cinza: '#6b6b6b', cinzaBg: '#efece6',
}
export type EhsStatus = 'verde' | 'amarelo' | 'vermelho' | 'cinza'
const COR: Record<EhsStatus, { fg: string; bg: string }> = {
  verde: { fg: EHS.verde, bg: EHS.verdeBg }, amarelo: { fg: EHS.amarelo, bg: EHS.amareloBg },
  vermelho: { fg: EHS.vermelho, bg: EHS.vermelhoBg }, cinza: { fg: EHS.cinza, bg: EHS.cinzaBg },
}
const SERIF = 'Fraunces, Georgia, serif'
const SOMBRA = '0 1px 3px rgba(61, 35, 20, 0.06)'

export function EhsHeader({ marca, subtitulo, titulo, desc, acoes }: {
  marca: string; subtitulo: string; titulo: string; desc: string; acoes?: ReactNode
}) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', margin: 0, color: EHS.gold }}>
          {marca} <span style={{ color: EHS.muted, fontWeight: 500, letterSpacing: 0.5, textTransform: 'none' }}>· {subtitulo}</span>
        </p>
        <h1 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, margin: '4px 0 6px', color: EHS.espresso }}>{titulo}</h1>
        <p style={{ margin: 0, fontSize: 14, color: EHS.muted }}>{desc}</p>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{acoes}</div>
    </header>
  )
}

export function EhsLangSwitch({ lang, onChange, rotulo }: { lang: EhsLang; onChange: (l: EhsLang) => void; rotulo: string }) {
  return (
    <div role="group" aria-label={rotulo} style={{ display: 'inline-flex', border: `1px solid ${EHS.borderLt}`, borderRadius: 999, overflow: 'hidden', background: 'white' }}>
      {EHS_LANGS.map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => onChange(l)}
          style={{ minHeight: 40, minWidth: 44, padding: '0 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
            background: lang === l ? EHS.espresso : 'transparent', color: lang === l ? 'white' : EHS.espresso }}>
          {l}
        </button>
      ))}
    </div>
  )
}

/** Cartão de status: a cor só aparece no número/faixa lateral quando há semáforo. */
export function EhsStatusCard({ rotulo, valor, status, carregando }: { rotulo: string; valor: number | string; status?: EhsStatus; carregando?: boolean }) {
  const cor = status ? COR[status].fg : EHS.espresso
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: '16px 18px', boxShadow: SOMBRA, borderLeft: `4px solid ${status ? cor : EHS.gold}` }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: EHS.muted, margin: 0 }}>{rotulo}</p>
      <p style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, margin: '4px 0 0', color: cor }}>{carregando ? '…' : valor}</p>
    </div>
  )
}

export function EhsStatusPill({ status, texto }: { status: EhsStatus; texto: string }) {
  const c = COR[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: c.bg, color: c.fg }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: c.fg }} />
      {texto}
    </span>
  )
}

/** Atalho grande (alvo de toque confortável, usável com luva). */
export function EhsAtalho({ href, titulo, desc }: { href: string; titulo: string; desc: string }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', color: EHS.ink, display: 'block', minHeight: 64 }}>
      <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', boxShadow: SOMBRA, borderTop: `3px solid ${EHS.gold}`, height: '100%' }}>
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500, color: EHS.espresso }}>{titulo}</div>
        <div style={{ fontSize: 12, color: EHS.muted, marginTop: 4 }}>{desc}</div>
      </div>
    </Link>
  )
}

export type EhsEvento = { id: string; data: string; titulo: string; detalhe?: string; status?: EhsStatus }
/** Linha do tempo da ficha viva (exames, EPIs, treinamentos, ocorrências, documentos) com semáforo. */
export function EhsTimeline({ eventos }: { eventos: EhsEvento[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {eventos.map((e) => (
        <li key={e.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: `1px solid ${EHS.borderLt}` }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, marginTop: 5, flex: '0 0 auto', background: e.status ? COR[e.status].fg : EHS.gold }} />
          <div>
            <div style={{ fontSize: 12, color: EHS.muted }}>{e.data}</div>
            <div style={{ fontWeight: 600, color: EHS.espresso }}>{e.titulo}</div>
            {e.detalhe && <div style={{ fontSize: 13, color: EHS.muted }}>{e.detalhe}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Painel lateral: edita sem sair da lista. */
export function EhsSidePanel({ aberto, titulo, onFechar, children, fecharRotulo = 'Fechar' }: {
  aberto: boolean; titulo: string; onFechar: () => void; children: ReactNode; fecharRotulo?: string
}) {
  if (!aberto) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end', background: 'rgba(61,35,20,0.35)' }}
      onClick={onFechar}>
      <aside onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 100%)', background: EHS.offwhite, height: '100%', overflowY: 'auto', padding: 20, boxShadow: '-4px 0 16px rgba(61,35,20,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 400, margin: 0, color: EHS.espresso }}>{titulo}</h2>
          <button type="button" onClick={onFechar} style={{ minHeight: 44, minWidth: 44, border: `1px solid ${EHS.borderLt}`, borderRadius: 8, background: 'white', cursor: 'pointer' }}>{fecharRotulo}</button>
        </div>
        {children}
      </aside>
    </div>
  )
}

/** Assistente passo a passo com a prévia do documento ao lado (empilha no celular). */
export function EhsAssistente({ passos, atual, formulario, previa }: { passos: string[]; atual: number; formulario: ReactNode; previa: ReactNode }) {
  return (
    <div>
      <ol style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 16px', flexWrap: 'wrap' }}>
        {passos.map((p, i) => (
          <li key={p} aria-current={i === atual ? 'step' : undefined}
            style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: i === atual ? EHS.espresso : i < atual ? EHS.gold : 'white', color: i <= atual ? 'white' : EHS.muted, border: `1px solid ${EHS.borderLt}` }}>
            {i + 1}. {p}
          </li>
        ))}
      </ol>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <section style={{ background: 'white', borderRadius: 12, padding: 20, boxShadow: SOMBRA }}>{formulario}</section>
        <section aria-live="polite" style={{ background: 'white', borderRadius: 12, padding: 20, boxShadow: SOMBRA, borderTop: `3px solid ${EHS.gold}` }}>{previa}</section>
      </div>
    </div>
  )
}
