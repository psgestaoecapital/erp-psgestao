/**
 * #5684 · nome (xNome) do destinatário da NF-e da venda de veículo.
 * Pessoa física não tem razão social no cadastro (só "Nome / Apelido" → nome_fantasia): usa o nome do cadastro.
 * Pessoa jurídica segue exigindo razão social (devolve '' e o validador barra). Nada é gravado.
 */
export function nomeDestinatarioNFe(razaoSocial: string | null | undefined, nomeFantasia: string | null | undefined, docLimpo: string): string {
  const razao = (razaoSocial ?? '').trim()
  if (razao) return razao
  return docLimpo.length === 11 ? (nomeFantasia ?? '').trim() : ''
}
