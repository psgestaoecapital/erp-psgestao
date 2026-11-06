// HB2 — de onde vem o preço de um serviço: contrato do cliente > tabela por cliente > tabela padrão.
// Mesma regra para a tela, o orçamento e a medição; o motivo vai em linguagem simples para o vendedor conferir.
export type OrigemPreco = 'contrato' | 'tabela_cliente' | 'tabela_padrao' | 'sem_preco'
export interface EntradaPrecedencia {
  /** a tabela escolhida é contrato assinado com o cliente (vigente hoje) */
  contratoVigente: boolean
  /** tabela escolhida existe para o cliente, mas sem contrato vigente */
  tabelaCliente: boolean
  /** existe preço na tabela padrão para o serviço */
  tabelaPadrao: boolean
  /** a faixa da quantidade pedida tem preço na tabela escolhida */
  temFaixa: boolean
}
export interface ResultadoPrecedencia { origem: OrigemPreco; rotulo: string; motivo: string }

export function precedenciaPreco(e: EntradaPrecedencia): ResultadoPrecedencia {
  if (e.temFaixa && e.contratoVigente) return { origem: 'contrato', rotulo: 'Contrato do cliente', motivo: 'O cliente tem contrato vigente com este serviço, então o preço contratado vale e as outras tabelas não entram.' }
  if (e.temFaixa && e.tabelaCliente) return { origem: 'tabela_cliente', rotulo: 'Tabela do cliente', motivo: 'Não há contrato vigente; vale a tabela combinada com este cliente.' }
  if (e.tabelaPadrao) return { origem: 'tabela_padrao', rotulo: 'Tabela padrão', motivo: 'O cliente não tem preço para esta quantidade; vale a tabela padrão da empresa.' }
  return { origem: 'sem_preco', rotulo: 'Sem preço', motivo: 'Nenhuma tabela tem preço para este serviço e quantidade. Cadastre uma faixa antes de orçar.' }
}
