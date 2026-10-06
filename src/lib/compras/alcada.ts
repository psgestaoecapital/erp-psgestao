// #1677 · regras puras da alçada de compras (núcleo, todas as empresas). Usadas pela solicitação (PR B) e conferidas por gate.

export type AlcadaConfig = {
  min_orcamentos: 1 | 3
  urgencia_categorias: string[]
  urgencia_produto_ids: string[]
}

export const ALCADA_PADRAO: AlcadaConfig = { min_orcamentos: 3, urgencia_categorias: [], urgencia_produto_ids: [] }

/** Orçamentos exigidos: 3 por padrão; 1 só se a empresa configurou assim. Qualquer outro valor cai no padrão (3). */
export function orcamentosExigidos(cfg: Pick<AlcadaConfig, 'min_orcamentos'> | null | undefined): 1 | 3 {
  return cfg?.min_orcamentos === 1 ? 1 : 3
}

export function orcamentosSuficientes(anexados: number, cfg: Pick<AlcadaConfig, 'min_orcamentos'> | null | undefined): boolean {
  return anexados >= orcamentosExigidos(cfg)
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/** Compra urgente só vale se TODOS os itens estão na lista liberada (por produto ou por categoria). Lista vazia = nada liberado. */
export function urgenciaPermitida(
  itens: { produto_id?: string | null; categoria?: string | null }[],
  cfg: Pick<AlcadaConfig, 'urgencia_categorias' | 'urgencia_produto_ids'> | null | undefined,
): boolean {
  if (!cfg || itens.length === 0) return false
  const cats = new Set(cfg.urgencia_categorias.map(norm))
  const prods = new Set(cfg.urgencia_produto_ids)
  return itens.every((i) => (i.produto_id ? prods.has(i.produto_id) : false) || (i.categoria ? cats.has(norm(i.categoria)) : false))
}

/** Quem solicita não aprova a própria compra. */
export function podeAprovar(solicitanteId: string | null | undefined, aprovadorId: string | null | undefined): boolean {
  return !!aprovadorId && aprovadorId !== solicitanteId
}
