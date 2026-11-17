'use client'
// #6874 — campo de dinheiro padrão: formata em R$ automaticamente enquanto digita.
// Use no lugar de <input type="number"> para valores em reais. `value` é o texto mascarado.
import type { CSSProperties } from 'react'
import { moedaMascara } from '@/lib/moeda-mascara'

export function CampoMoeda({ value, onChange, placeholder, style, className, id, disabled, readOnly, title, testId }: {
  value: string
  onChange: (mascarado: string) => void
  placeholder?: string
  style?: CSSProperties
  className?: string
  id?: string
  disabled?: boolean
  readOnly?: boolean
  title?: string
  testId?: string
}) {
  return (
    <input
      id={id}
      data-testid={testId}
      value={value}
      disabled={disabled}
      readOnly={readOnly}
      title={title}
      onChange={(e) => { if (!readOnly) onChange(moedaMascara(e.target.value)) }}
      placeholder={placeholder}
      inputMode="numeric"
      autoComplete="off"
      className={className}
      style={style}
    />
  )
}
