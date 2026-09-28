// IBPT por empresa · escolha do item do "Salvar e testar" (Configurações › Fiscal). Sem dependências: o gate de
// build e o teste de aceitação usam a mesma regra que a rota.
//
// CEO 28/09: produto com NCM inválido (vazio, com menos de 8 dígitos ou 00000000) NÃO serve de teste — pula para o
// próximo. Na FC, o teste pegou um "produto" NCM 00000000 que na verdade é o serviço de mão de obra.

/** NCM de 8 dígitos utilizável na consulta do IBPT; null se vazio, incompleto ou 00000000. */
export function ncmValidoParaTeste(ncm: string | null | undefined): string | null {
  const d = String(ncm ?? '').replace(/\D/g, '')
  if (d.length !== 8 || /^0+$/.test(d)) return null
  return d
}

/** Primeiro produto com NCM válido, preferindo o prefixo pedido (ex.: '2710', óleo — 1ª prova na KGF). */
export function escolherProdutoTeste<T extends { ncm: string | null }>(produtos: T[], prefixo = ''): (T & { ncmTeste: string }) | null {
  const validos = produtos
    .map((p) => ({ ...p, ncmTeste: ncmValidoParaTeste(p.ncm) }))
    .filter((p): p is T & { ncmTeste: string } => p.ncmTeste !== null)
  return validos.find((p) => p.ncmTeste.startsWith(prefixo)) ?? validos[0] ?? null
}
