// Vínculos operacionais de um produto: se algum existir, o produto não pode ser excluído — só inativado.
// Chamado #3856 (FC Pisos): a exclusão é lógica (ativo = false), então o histórico continua no banco. O bloqueio
// existe para não deixar um produto sair do cadastro enquanto ainda é usado em venda, compra, nota, estoque ou obra.
// Histórico de preço e de-para de fornecedor NÃO bloqueiam: a inativação preserva os dois.

export type AlvoVinculo =
  | { tipo: 'coluna'; rotulo: string; tabela: string; coluna: string }
  // NF-e/NFC-e guardam os itens em JSON (erp_nfe_emitidas.itens[].codigo), não numa tabela de itens
  | { tipo: 'json_codigo'; rotulo: string; tabela: string; coluna: string }

export type Vinculo = { rotulo: string; total: number }

export const ALVOS_VINCULO_PRODUTO: AlvoVinculo[] = [
  { tipo: 'coluna', rotulo: 'Pedidos de venda', tabela: 'erp_pedidos_itens', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Orçamentos', tabela: 'erp_orcamentos_itens', coluna: 'produto_id' },
  { tipo: 'json_codigo', rotulo: 'Notas fiscais emitidas (NF-e e NFC-e)', tabela: 'erp_nfe_emitidas', coluna: 'itens' },
  { tipo: 'coluna', rotulo: 'Notas fiscais recebidas (entrada)', tabela: 'erp_nfe_recebidas_itens', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Movimentações de estoque', tabela: 'erp_estoque_movimentacoes', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Inventário', tabela: 'erp_inventario_itens', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Compras', tabela: 'erp_compras_itens', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Solicitações de compra', tabela: 'erp_compras_solicitacao_item', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Cotações', tabela: 'erp_cotacoes_itens', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Composição de serviços', tabela: 'erp_servicos_produtos', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Calculadora de obra', tabela: 'erp_calc_depara', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Reserva de material de obra', tabela: 'obra_reserva_material', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Peças de OS (solicitação)', tabela: 'erp_os_peca_solicitacao', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Peças de OS (diagnóstico)', tabela: 'erp_os_diagnostico_item', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Insumos de procedimento', tabela: 'erp_odonto_procedimento_insumo', coluna: 'produto_id' },
  { tipo: 'coluna', rotulo: 'Insumos de orçamento de obra', tabela: 'hub_insumo_produto', coluna: 'produto_id' },
]

// Conta quantos registros usam o produto em cada alvo. `contar` é injetado: a rota passa a consulta real (service role)
// e o gate passa um falso — a regra fica testável sem banco.
export async function listarVinculosProduto(
  contar: (alvo: AlvoVinculo) => Promise<number>,
  alvos: AlvoVinculo[] = ALVOS_VINCULO_PRODUTO,
): Promise<Vinculo[]> {
  const totais = await Promise.all(alvos.map((a) => contar(a)))
  return alvos
    .map((a, i) => ({ rotulo: a.rotulo, total: totais[i] }))
    .filter((v) => v.total > 0)
}

export function mensagemBloqueio(vinculos: Vinculo[]): string {
  const lista = vinculos.map((v) => `${v.rotulo} (${v.total})`).join(', ')
  return `Este produto não pode ser excluído porque já é usado em: ${lista}. Inative o produto para tirá-lo da venda e da compra; o histórico continua preservado.`
}
