'use client'

import React from 'react'
import { PSGC_COLORS, PSGC_SPACING, PSGC_TYPO } from '@/lib/psgc-tokens'
import { CORES_FEEDBACK } from './contratoSalvar'

// ═══════════════════════════════════════════════════════════════════════════
// RASCUNHO (RD-26) · Wrapper de campo com estado de erro. Extraído do helper
// Campo() copiado inline em NovaDespesaForm/NovaReceitaForm + destaque vermelho
// quando `erro` vem preenchido. Ancorado em psgc-tokens (zero literal).
//
// O destaque de BORDA do input fica no próprio <input>, via estiloBordaInput()
// do contrato (o input é `children`, então o wrapper não o estiliza direto —
// mantém desacoplado; ver README). Aqui vão: label vermelho, asterisco e a
// mensagem "Faltou preencher X" abaixo do campo.
// ═══════════════════════════════════════════════════════════════════════════

export function Campo({
  label,
  children,
  obrigatorio = false,
  fullWidth = false,
  erro = null,
}: {
  label: string
  children: React.ReactNode
  obrigatorio?: boolean
  fullWidth?: boolean
  erro?: string | null // mensagem do campo; quando truthy → label/asterisco/mensagem em vermelho
}) {
  return (
    <div
      style={fullWidth ? { gridColumn: '1 / -1' } : undefined}
      data-erro={erro ? 'true' : undefined}
    >
      <label
        style={{
          display: 'block',
          fontSize: PSGC_TYPO.small.size,
          letterSpacing: PSGC_TYPO.small.letterSpacing,
          color: erro ? CORES_FEEDBACK.erroTexto : PSGC_COLORS.espressoLight,
          marginBottom: PSGC_SPACING.xs,
          fontWeight: 500,
        }}
      >
        {label}
        {obrigatorio && (
          <span style={{ color: CORES_FEEDBACK.erroTexto, marginLeft: PSGC_SPACING.xs }}>*</span>
        )}
      </label>

      {children}

      {erro && (
        <small
          role="alert"
          style={{
            display: 'block',
            marginTop: PSGC_SPACING.xs,
            fontSize: PSGC_TYPO.small.size,
            fontWeight: 600,
            color: CORES_FEEDBACK.erroTexto,
          }}
        >
          {erro}
        </small>
      )}
    </div>
  )
}

export default Campo
