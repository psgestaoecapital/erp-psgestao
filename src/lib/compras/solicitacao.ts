// #1677 (B2) · regras puras da solicitação de compra (tela). O banco confere de novo em fn_compras_solicitacao_*.
import { orcamentosExigidos, urgenciaPermitida, type AlcadaConfig } from './alcada'

export type ItemForm = { produto_id: string; descricao: string; categoria: string; quantidade: string; unidade: string }

export const ITEM_VAZIO: ItemForm = { produto_id: '', descricao: '', categoria: '', quantidade: '1', unidade: 'UN' }

export const STATUS_ROTULO: Record<string, string> = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  cancelada: 'Cancelada',
}

/** Quantidade digitada (aceita vírgula). Inválida → NaN. */
export function lerQuantidade(q: string): number {
  const t = String(q).trim()
  const n = t === '' ? NaN : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : NaN
}

/** Validação do formulário antes de salvar. Devolve a mensagem de erro ou null. */
export function validarSolicitacaoForm(f: { titulo: string; itens: ItemForm[] }): string | null {
  if (f.titulo.trim().length < 3) return 'Descreva a compra (mínimo 3 letras).'
  if (f.itens.length === 0) return 'Inclua ao menos um item.'
  for (const i of f.itens) {
    if (!i.descricao.trim()) return 'Cada item precisa de descrição.'
    if (!(lerQuantidade(i.quantidade) > 0)) return `Quantidade inválida no item "${i.descricao.trim()}".`
  }
  return null
}

/**
 * O que ainda falta para enviar (mesma regra de fn_compras_solicitacao_enviar). Lista vazia = pode enviar.
 * Urgente dispensa os orçamentos só se todos os itens estão liberados na alçada; o aprovador decide do mesmo jeito.
 */
export function pendenciasEnvio(
  s: { urgente: boolean; itens: { produto_id?: string | null; categoria?: string | null }[]; orcamentos: number },
  alcada: (AlcadaConfig & { configurada?: boolean; aprovador_principal_id?: string | null }) | null | undefined,
): string[] {
  const p: string[] = []
  if (!alcada?.configurada || !alcada.aprovador_principal_id) p.push('A empresa ainda não definiu o aprovador (Compras > Alçada de compras).')
  if (s.itens.length === 0) p.push('Inclua ao menos um item.')
  if (s.urgente) {
    if (s.itens.length > 0 && !urgenciaPermitida(s.itens, alcada)) p.push('Há itens fora das categorias de compra urgente: desmarque "urgente" e anexe os orçamentos.')
  } else {
    const falta = orcamentosExigidos(alcada) - s.orcamentos
    if (falta > 0) p.push(`Anexe ${orcamentosExigidos(alcada)} orçamento(s) (faltam ${falta}).`)
  }
  return p
}

/** Caminho do arquivo no bucket privado: 1ª pasta = empresa (a policy do storage e a RPC conferem). */
export function caminhoOrcamento(companyId: string, solicitacaoId: string, nomeArquivo: string, agora = Date.now()): string {
  const limpo = nomeArquivo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80) || 'orcamento'
  return `${companyId}/${solicitacaoId}/${agora}_${limpo}`
}
