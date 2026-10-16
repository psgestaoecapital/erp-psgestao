// #135 (Triches) · aprovar o orçamento na própria Ordem de Serviço (atendimento centralizado, sem tablet).
// Regra única usada pela ficha da OS (OrdemServicoCard) e conferida pelo gate check-os-aprovar-orcamento.
import type { ModeloAtendimento } from './modelo'

export type ItemOS = { id?: string | null; status_item?: string | null; preco?: number | null; subtotal?: number | null }

// Só item gravado e ainda sem decisão do cliente. Recusado/aprovado não muda (RD-55: decisão não se sobrescreve).
export function itensPendentesOS<T extends ItemOS>(itens: T[]): T[] {
  return itens.filter((it) => !!it.id && (it.status_item ?? 'pendente') === 'pendente')
}

// O botão aparece só no atendimento centralizado, para quem pode lançar valor, com a OS antes da execução.
export function podeAprovarNaOS(modelo: ModeloAtendimento, podePreco: boolean, status: string, pendentes: number): boolean {
  return modelo === 'centralizado' && podePreco && ['aberta', 'aguardando_aprovacao'].includes(status) && pendentes > 0
}
