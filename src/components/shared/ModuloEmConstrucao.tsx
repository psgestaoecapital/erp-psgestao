// src/components/shared/ModuloEmConstrucao.tsx
// Placeholder amigavel generico para modulos catalogados em module_catalog
// mas ainda nao implementados em codigo. Mostra o titulo, o que sera entregue
// e quando, alem de CTAs para fluxos atuais da area.
//
// Substitui o componente BPO-especifico (BpoModuloEmConstrucao) que ficava
// acoplado a uma area. Este componente recebe `area` (texto curto) e atalhos
// customizados via props.

import Link from 'next/link'

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offWhite: '#FAF7F2',
  cream: '#F0ECE3',
  gold: '#C8941A',
  border: '#E0D8CC',
}

export type AtalhoModulo = { label: string; href: string }

type Props = {
  area: string
  titulo: string
  descricao: string
  previsao: string
  atalhos?: AtalhoModulo[]
  // Props opcionais (retrocompativeis — 13 usos existentes nao precisam mexer):
  // recursos: lista "O que vem ai". ctaPriorizacao: link p/ /admin/projeto.
  recursos?: string[]
  ctaPriorizacao?: boolean
}

export default function ModuloEmConstrucao({
  area,
  titulo,
  descricao,
  previsao,
  atalhos = [],
  recursos = [],
  ctaPriorizacao = false,
}: Props) {
  return (
    <div style={{ padding: 'clamp(16px, 4vw, 32px)', maxWidth: 820, margin: '0 auto', color: C.espresso }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.55, margin: 0 }}>
          {area}
        </p>
        <span
          style={{
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 999,
            background: C.gold + '22',
            color: C.gold,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          Em construcao
        </span>
      </div>

      <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 12px' }}>
        {titulo}
      </h1>

      <p style={{ color: C.espressoM, fontSize: 14, lineHeight: 1.6, marginBottom: 18, maxWidth: 640 }}>
        {descricao}
      </p>

      <div
        style={{
          background: '#FAF0DF',
          border: `1px solid ${C.gold}`,
          borderLeft: `4px solid ${C.gold}`,
          borderRadius: 10,
          padding: 16,
          fontSize: 13,
          color: C.espresso,
          marginBottom: 24,
          maxWidth: 640,
        }}
      >
        <strong>Previsao de entrega:</strong> {previsao}
      </div>

      {recursos.length > 0 && (
        <div style={{ marginBottom: 24, maxWidth: 640 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: C.espressoL, margin: '0 0 10px' }}>
            O que vem aí
          </h2>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recursos.map((r, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, color: C.espressoM, lineHeight: 1.5 }}>
                <span style={{ marginTop: 7, width: 6, height: 6, borderRadius: 999, background: C.gold, flexShrink: 0 }} />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {atalhos.length > 0 && (
        <>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: C.espressoL, margin: '0 0 10px' }}>
            Enquanto isso, use:
          </h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {atalhos.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: '#FFFFFF',
                  color: C.espresso,
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                {a.label}
              </Link>
            ))}
          </div>
        </>
      )}

      {ctaPriorizacao && (
        <p style={{ fontSize: 12, color: C.espressoL, marginTop: 24 }}>
          Esta feature está no roadmap. Quer prioridade?{' '}
          <Link href="/admin/projeto" style={{ color: C.gold, fontWeight: 600, textDecoration: 'underline' }}>
            Solicite priorização
          </Link>
        </p>
      )}
    </div>
  )
}
