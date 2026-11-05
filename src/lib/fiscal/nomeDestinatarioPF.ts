/**
 * Nome do destinatário da NF-e a partir do cadastro de clientes (erp_clientes).
 * Pessoa física não tem "Razão social" na tela de cadastro (só "Nome / Apelido" → nome_fantasia):
 * usa razao_social e, se vazia, o nome_fantasia. Pessoa jurídica NÃO ganha fallback: a validação
 * continua exigindo razão social. Não grava nada.
 */
export function nomeDestinatario(
  cli: { razao_social?: string | null; nome_fantasia?: string | null },
  docLimpo: string,
): string {
  const razao = (cli.razao_social ?? '').trim()
  if (razao) return razao
  if (docLimpo.length === 11) return (cli.nome_fantasia ?? '').trim()
  return ''
}
