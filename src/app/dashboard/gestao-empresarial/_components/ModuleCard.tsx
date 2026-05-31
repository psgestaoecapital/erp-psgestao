'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens'

export interface ModuloHub {
  id: string
  titulo: string
  descricao: string
  icone: string
  cor_tema: string
  rota: string
  status: string
  pct_pronto: number
  tem_dados: boolean
  observacao: string
}

// Badges em tokens espresso/off-white/dourado. Verde/amarelo/vermelho são
// reservados ao semáforo de performance (lei de design psgc-tokens), por isso
// não usamos cores semânticas de status aqui.
function statusStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    padding: '3px 8px',
    borderRadius: 999,
    border: `1px solid ${PSGC_COLORS.offWhiteDarker}`,
    backgroundColor: PSGC_COLORS.offWhiteDark,
    color: PSGC_COLORS.espressoLight,
  }
  if (status === 'EM CONSTRUÇÃO') {
    return { ...base, borderColor: PSGC_COLORS.dourado, color: PSGC_COLORS.dourado, backgroundColor: 'white' }
  }
  if (status === 'PRONTO') {
    return { ...base, borderColor: PSGC_COLORS.espresso, color: PSGC_COLORS.espresso, backgroundColor: 'white' }
  }
  return base
}

export function ModuleCard({ modulo }: { modulo: ModuloHub }) {
  return (
    <Link
      href={modulo.rota}
      style={{
        position: 'relative',
        display: 'block',
        backgroundColor: 'white',
        border: `1px solid ${PSGC_COLORS.offWhiteDarker}`,
        borderRadius: PSGC_RADIUS.lg,
        padding: 24,
        textDecoration: 'none',
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 6px 18px rgba(61, 35, 20, 0.1)'
        e.currentTarget.style.borderColor = PSGC_COLORS.dourado
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.borderColor = PSGC_COLORS.offWhiteDarker
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 30, lineHeight: 1 }}>{modulo.icone}</div>
        <span style={statusStyle(modulo.status)}>{modulo.status}</span>
      </div>

      <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, color: PSGC_COLORS.espresso, margin: '0 0 8px' }}>
        {modulo.titulo}
      </h3>

      <p style={{ fontSize: 13, color: PSGC_COLORS.espressoLight, margin: '0 0 16px', minHeight: '2.6em', lineHeight: 1.4 }}>
        {modulo.descricao}
      </p>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: PSGC_COLORS.espressoLight, marginBottom: 4 }}>
          <span>Evolução</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{modulo.pct_pronto}%</span>
        </div>
        <div style={{ height: 6, backgroundColor: PSGC_COLORS.offWhiteDark, borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${modulo.pct_pronto}%`, backgroundColor: PSGC_COLORS.dourado, transition: 'width 0.5s' }} />
        </div>
      </div>

      {modulo.observacao && (
        <p style={{ fontSize: 11, color: PSGC_COLORS.espressoLight, fontStyle: 'italic', margin: '0 0 12px', lineHeight: 1.4 }}>
          {modulo.observacao}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: PSGC_COLORS.dourado }}>
        <span>Acessar módulo</span>
        <ArrowRight size={16} />
      </div>

      {modulo.tem_dados && (
        <div
          title="Dados disponíveis no banco"
          style={{ position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: 999, backgroundColor: PSGC_COLORS.dourado }}
        />
      )}
    </Link>
  )
}
