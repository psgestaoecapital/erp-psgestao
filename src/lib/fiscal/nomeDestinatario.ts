/**
 * Nome do destinatário da NF-e de venda de veículo. Pessoa jurídica: razão social (obrigatória, sem fallback).
 * Pessoa física: o cadastro de PF só tem "Nome / Apelido" (grava em nome_fantasia), então usa-se esse nome quando a
 * razão social está vazia. Não altera dado gravado.
 */
export function nomeDestinatarioVenda(razaoSocial: string | null | undefined, nomeFantasia: string | null | undefined, pessoaFisica: boolean): string {
  const razao = (razaoSocial ?? '').trim()
  if (razao) return razao
  return pessoaFisica ? (nomeFantasia ?? '').trim() : ''
}
