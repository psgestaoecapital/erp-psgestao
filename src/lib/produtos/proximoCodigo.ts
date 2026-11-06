// Sugestão do próximo código de produto (#3255): olha os códigos mais recentes da empresa, pega o prefixo do último
// cadastrado (ex.: "PROD-" em "PROD-041") e devolve o maior número desse prefixo + 1, mantendo os zeros à esquerda.
// É só sugestão: o banco garante código único por empresa (erp_produtos_company_id_codigo_key).
export function sugerirProximoCodigo(codigosRecentes: string[]): string {
  const partes = codigosRecentes
    .map((c) => (c ?? '').trim().match(/^(.*?)(\d+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
  if (!partes.length) return ''
  const prefixo = partes[0][1]
  const doPrefixo = partes.filter((m) => m[1] === prefixo)
  let maior = doPrefixo[0]
  for (const m of doPrefixo) if (BigInt(m[2]) > BigInt(maior[2])) maior = m
  const proximo = (BigInt(maior[2]) + BigInt(1)).toString()
  return prefixo + proximo.padStart(maior[2].length, '0')
}

// Conferência antes de salvar um produto NOVO: mensagens em linguagem do usuário (código, NCM, preço de venda).
export function validarProdutoNovo(p: { codigo: string; nome: string; ncm: string; precoVenda: string }): string | null {
  if (!p.codigo.trim()) return 'Informe o código do produto.'
  if (p.nome.trim().length < 2) return 'Informe o nome do produto.'
  const ncm = p.ncm.replace(/\D/g, '')
  if (ncm && ncm.length !== 8) return 'O NCM tem 8 números (ex.: 87089990). Confira na aba Fiscal.'
  const preco = parseFloat(String(p.precoVenda).replace(',', '.'))
  if (!(preco > 0)) return 'Informe o preço de venda na aba Preços: produto sem preço trava a venda.'
  return null
}
