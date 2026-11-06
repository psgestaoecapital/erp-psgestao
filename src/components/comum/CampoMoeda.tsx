'use client'
// #6874 — campo de dinheiro padrão: formata em R$ automaticamente enquanto digita.
// Use no lugar de <input type="number"> para valores em reais. `value` é o texto mascarado.
import type { CSSProperties } from 'react'
import { moedaMascara } from '@/lib/moeda-mascara'

export function CampoMoeda({ value, onChange, placeholder, style, id, disabled, testId }: {
  value: string
  onChange: (mascarado: string) => void
  placeholder?: string
  style?: CSSProperties
  id?: string
  disabled?: boolean
  testId?: string
}) {
  return (
    <input
      id={id}
      data-testid={testId}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(moedaMascara(e.target.value))}
      placeholder={placeholder}
      inputMode="numeric"
      autoComplete="off"
      style={style}
    />
  )
}
