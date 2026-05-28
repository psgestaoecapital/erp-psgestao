'use client'

import { useState } from 'react'
import type { AlertaCritico } from '@/hooks/useDashboardOperacional'

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface Props {
  alertas: AlertaCritico[]
}

export default function FaixaAlertas({ alertas }: Props) {
  const [expandido, setExpandido] = useState(false)
  if (!alertas || alertas.length === 0) return null

  const primeiro = alertas[0]
  const restante = alertas.length - 1

  return (
    <div style={{ background: '#FEE2E2', borderLeft: '4px solid #DC2626', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flexShrink: 0, fontSize: 18 }} aria-hidden>⚠️</div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, color: '#7F1D1D', fontWeight: 600 }}>
          {alertas.length} alerta{alertas.length === 1 ? '' : 's'} imediato{alertas.length === 1 ? '' : 's'}: <span style={{ fontWeight: 500 }}>{primeiro.mensagem || `${primeiro.pessoa} · R$ ${fmt(primeiro.valor)}`}</span>
        </div>
        {expandido && (
          <ul style={{ margin: '8px 0 0', padding: '0 0 0 18px', fontSize: 12, color: '#7F1D1D', lineHeight: 1.6 }}>
            {alertas.slice(1).map((a, i) => (
              <li key={`${a.tipo}-${a.pessoa}-${i}`}>
                {a.mensagem || `${a.pessoa} · R$ ${fmt(a.valor)} · ${a.dias_atraso} dias`}
              </li>
            ))}
          </ul>
        )}
      </div>
      {restante > 0 && (
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          style={{ background: 'transparent', border: '0.5px solid rgba(127,29,29,0.4)', color: '#7F1D1D', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
        >
          {expandido ? 'Ocultar' : `Ver todos (${restante + 1})`}
        </button>
      )}
    </div>
  )
}
