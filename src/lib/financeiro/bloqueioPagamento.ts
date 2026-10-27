// #1672 · bloqueio de pagamento de conta a pagar (núcleo, todas as empresas). Regras puras, usadas pela tela
// de contas a pagar, pela remessa de pagamento e conferidas por gate.

export const MOTIVO_MIN = 3

export function motivoValido(m: string | null | undefined): boolean {
  return (m ?? '').trim().length >= MOTIVO_MIN
}

/** Separa os títulos que podem ir para a remessa dos bloqueados (que ficam de fora, com a contagem para o aviso). */
export function separarBloqueados<T extends { id: string }>(titulos: T[], bloqueados: ReadonlySet<string>): { livres: T[]; fora: number } {
  const livres = titulos.filter((t) => !bloqueados.has(t.id))
  return { livres, fora: titulos.length - livres.length }
}

export function avisoBloqueadosFora(n: number): string | null {
  if (n <= 0) return null
  return `${n} ${n === 1 ? 'conta bloqueada ficou' : 'contas bloqueadas ficaram'} de fora da remessa (desbloqueie em Contas a pagar para incluir).`
}
