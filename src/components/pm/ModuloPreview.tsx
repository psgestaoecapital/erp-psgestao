'use client'
import type { CSSProperties, ReactNode } from 'react'

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DECF'
const TEXTM    = '#6b5444'

export type ModuloStatus = 'previsto' | 'em_breve' | 'pronto'

export type Funcionalidade = { titulo: string; descricao: string }

export interface ModuloPreviewProps {
  icone: ReactNode
  titulo: string
  subtitulo: string
  status: ModuloStatus
  badge?: string
  oQueE: string
  comoFunciona: string[]
  funcionalidades: Funcionalidade[]
  diferencialIA?: string
}

const STATUS_CFG: Record<ModuloStatus, { l: string; bg: string; fg: string }> = {
  previsto: { l: 'Previsto', bg: '#F0E9DE', fg: TEXTM },
  em_breve: { l: 'Em breve', bg: '#FCE9C2', fg: '#7A5A0F' },
  pronto:   { l: 'Pronto',   bg: '#DCEFD7', fg: '#1F5A1F' },
}

export default function ModuloPreview({
  icone, titulo, subtitulo, status, badge,
  oQueE, comoFunciona, funcionalidades, diferencialIA,
}: ModuloPreviewProps) {
  const cfg = STATUS_CFG[status]
  return (
    <div className="p-4 max-w-4xl mx-auto" style={{ color: ESPRESSO }}>
      {/* Cabeçalho */}
      <header className="mb-6">
        <div className="flex items-start gap-3 flex-wrap">
          <div style={iconWrap}>{icone}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-2xl font-bold leading-tight">{titulo}</h1>
              <span style={{ ...statusChip, background: cfg.bg, color: cfg.fg }}>{cfg.l}</span>
              {badge && (
                <span style={{ ...statusChip, background: DOURADO, color: '#fff' }}>{badge}</span>
              )}
            </div>
            <p className="text-sm" style={{ color: TEXTM }}>{subtitulo}</p>
          </div>
        </div>
      </header>

      {/* O que é */}
      <Sec titulo="O que é">
        <p className="text-sm leading-relaxed" style={{ color: ESPRESSO }}>{oQueE}</p>
      </Sec>

      {/* Como funciona */}
      <Sec titulo="Como funciona">
        <ol className="space-y-2">
          {comoFunciona.map((passo, i) => (
            <li key={i} className="flex gap-3" style={{ fontSize: 14 }}>
              <span style={passoNum}>{i + 1}</span>
              <span style={{ color: ESPRESSO, lineHeight: 1.5 }}>{passo}</span>
            </li>
          ))}
        </ol>
      </Sec>

      {/* Funcionalidades */}
      <Sec titulo="Funcionalidades">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {funcionalidades.map((f, i) => (
            <div key={i} style={funcCard}>
              <div className="font-semibold text-sm mb-1" style={{ color: ESPRESSO }}>{f.titulo}</div>
              <div className="text-sm" style={{ color: TEXTM, lineHeight: 1.5 }}>{f.descricao}</div>
            </div>
          ))}
        </div>
      </Sec>

      {/* Diferencial IA */}
      {diferencialIA && (
        <div style={iaBox}>
          <div style={iaLabel}>✨ Diferencial IA</div>
          <p style={{ fontSize: 14, color: ESPRESSO, lineHeight: 1.5, margin: 0 }}>
            {diferencialIA}
          </p>
        </div>
      )}

      {/* Rodapé */}
      {status !== 'pronto' && (
        <p style={rodape}>
          Módulo em desenvolvimento — esta tela apresenta o que será entregue. Sua opinião ajuda a priorizar.
        </p>
      )}
    </div>
  )
}

function Sec({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: DOURADO, letterSpacing: 0.6 }}>
        {titulo}
      </h2>
      <div className="rounded-xl p-4" style={{ background: '#fff', border: `1px solid ${BORDA}` }}>
        {children}
      </div>
    </section>
  )
}

const iconWrap: CSSProperties = {
  width: 56, height: 56, borderRadius: 12,
  background: OFFWHITE, border: `1px solid ${BORDA}`,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 28, flexShrink: 0,
}
const statusChip: CSSProperties = {
  fontSize: 11, padding: '3px 10px', borderRadius: 999, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.4,
}
const passoNum: CSSProperties = {
  flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
  background: DOURADO, color: '#fff', fontSize: 12, fontWeight: 700,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const funcCard: CSSProperties = {
  border: `1px solid ${BORDA}`, borderRadius: 10, padding: 12,
  background: OFFWHITE,
}
const iaBox: CSSProperties = {
  background: 'linear-gradient(135deg, #FAEEDA 0%, #FCE9C2 100%)',
  border: `1px solid ${DOURADO}`,
  borderLeft: `4px solid ${DOURADO}`,
  borderRadius: 12, padding: 16, marginBottom: 16,
}
const iaLabel: CSSProperties = {
  fontSize: 11, fontWeight: 700, color: DOURADO,
  textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
}
const rodape: CSSProperties = {
  fontSize: 12, color: TEXTM, fontStyle: 'italic',
  textAlign: 'center', padding: '12px 0', borderTop: `1px dashed ${BORDA}`, marginTop: 16,
}
