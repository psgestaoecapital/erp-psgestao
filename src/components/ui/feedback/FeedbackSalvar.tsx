'use client'

import React from 'react'
import { PSGC_RADIUS, PSGC_SPACING, PSGC_TYPO } from '@/lib/psgc-tokens'
import { CORES_FEEDBACK } from './contratoSalvar'

// ═══════════════════════════════════════════════════════════════════════════
// RASCUNHO (RD-26) · Mensagem de salvamento em LOCAL FIXO idêntico em toda tela.
// Extraído dos blocos de erro inline de NovaDespesaForm/NovaReceitaForm, mas
// ancorado em psgc-tokens (zero literal). NÃO ligado a nenhuma tela ainda.
//
// Uso previsto (piloto): renderizar SEMPRE no mesmo ponto do form (logo acima
// dos botões de ação, largura total). Erro persiste até o usuário corrigir;
// sucesso é limpo pelo chamador (após redirect/toast).
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoFeedback =
  | { tipo: 'erro'; texto: string }
  | { tipo: 'sucesso'; texto: string }
  | null

export default function FeedbackSalvar({ estado }: { estado: EstadoFeedback }) {
  if (!estado) return null
  const erro = estado.tipo === 'erro'
  return (
    <div
      role={erro ? 'alert' : 'status'}
      aria-live={erro ? 'assertive' : 'polite'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: PSGC_SPACING.sm,
        padding: `${PSGC_SPACING.md}px ${PSGC_SPACING.lg}px`,
        borderRadius: PSGC_RADIUS.md,
        marginBottom: PSGC_SPACING.lg,
        fontSize: PSGC_TYPO.bodyBold.size,
        fontWeight: PSGC_TYPO.bodyBold.weight,
        lineHeight: PSGC_TYPO.bodyBold.lineHeight,
        background: erro ? CORES_FEEDBACK.erroFundo : CORES_FEEDBACK.sucessoFundo,
        color: erro ? CORES_FEEDBACK.erroTexto : CORES_FEEDBACK.sucessoTexto,
        border: erro ? `1px solid ${CORES_FEEDBACK.erroBorda}` : undefined,
      }}
    >
      <span aria-hidden style={{ fontWeight: 800 }}>{erro ? '⚠' : '✓'}</span>
      <span>{estado.texto}</span>
    </div>
  )
}
