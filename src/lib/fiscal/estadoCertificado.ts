// Chamado #5661: estado do certificado A1 pela validade real — um certificado vencido NUNCA pode
// aparecer como "ATIVO". Função pura (sem dependências de React/DOM) para ser reutilizável e
// provada por gate (scripts/gates/check-estado-certificado.ts).
export type EstadoCertificado = 'ativo' | 'vence_breve' | 'vencido'

// Janela de "vence em breve": 30 dias corridos antes do fim da validade.
export const CERT_VENCE_BREVE_MS = 30 * 86400000

// Retorna o estado pela validade; null quando não há validade legível (certificado presente, mas
// sem data válida → o chamador mantém o comportamento neutro "ativo", como antes).
export function estadoCertificado(
  validadeFim: string | null | undefined,
  agora: number = Date.now(),
): EstadoCertificado | null {
  if (!validadeFim) return null
  const fimMs = new Date(validadeFim).getTime()
  if (!Number.isFinite(fimMs)) return null
  if (fimMs < agora) return 'vencido'
  if (fimMs - agora < CERT_VENCE_BREVE_MS) return 'vence_breve'
  return 'ativo'
}
