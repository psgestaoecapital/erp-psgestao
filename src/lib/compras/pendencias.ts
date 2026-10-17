// #1677 (B3) · regras puras da tela do comprador. A situação vem do banco (fn_compras_pendencias_listar); aqui só rótulo,
// filtro e o link para a cotação na tela de Cotações que já existe.

export type Situacao = 'pendente' | 'em_cotacao' | 'comprada'

export const SITUACAO_ROTULO: Record<Situacao, string> = {
  pendente: 'Pendente',
  em_cotacao: 'Em cotação',
  comprada: 'Comprada',
}

export const FILTROS_PENDENCIA = [
  { id: 'pendente', rotulo: 'Pendentes' },
  { id: 'em_cotacao', rotulo: 'Em cotação' },
  { id: 'comprada', rotulo: 'Compradas' },
  { id: 'todas', rotulo: 'Todas' },
] as const

export function filtrarPorSituacao<T extends { situacao: string }>(lista: T[], filtro: string): T[] {
  return filtro === 'todas' ? lista : lista.filter((p) => p.situacao === filtro)
}

/** Link para a cotação aberta na tela de Cotações (Compras › Cotações abre direto nela). */
export function linkCotacao(cotacaoId: string): string {
  return `/dashboard/commerce/compras?area=gestao_empresarial&cotacao=${encodeURIComponent(cotacaoId)}`
}
