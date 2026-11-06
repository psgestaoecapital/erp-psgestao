// #3861 (Gean): a busca de itens da NF-e avulsa carregava só os 500 primeiros produtos em ordem alfabética e filtrava
// no navegador — empresa com mais de 500 produtos não achava o resto ("Turbina L200 2006" é o 1.760º da Gean).
// Agora a busca vai ao banco, sempre presa à empresa (company_id) e a produtos ativos: cada palavra digitada precisa
// aparecer no nome OU no código, sem diferenciar maiúsculas/minúsculas e sem depender de espaços duplos do cadastro.

/** Palavras da busca, sem os caracteres que quebram o filtro `or` do PostgREST (vírgula, parênteses, curingas). */
export function termosBuscaProduto(texto: string): string[] {
  return texto
    .replace(/[%_,()*\\"']/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 5)
}

/** Filtro `or` de uma palavra: aparece no nome ou no código. Um `.or()` por palavra = todas as palavras (E). */
export function filtroTermoProduto(termo: string): string {
  return `nome.ilike.%${termo}%,codigo.ilike.%${termo}%`
}

/** Filtro `or` do começo: nome ou código que COMEÇA com a 1ª palavra vem antes (com "Turb", "Turbina L200" antes de "BIELA … TURBO"). */
export function filtroPrefixoProduto(termo: string): string {
  return `nome.ilike.${termo}%,codigo.ilike.${termo}%`
}

/** Junta as duas listas sem repetir: primeiro as que começam com a palavra, depois as que a contêm. */
export function juntarResultados<T extends { id: string }>(comeca: T[], contem: T[], max = 30): T[] {
  const vistos = new Set<string>()
  const out: T[] = []
  for (const p of [...comeca, ...contem]) {
    if (vistos.has(p.id)) continue
    vistos.add(p.id)
    out.push(p)
  }
  return out.slice(0, max)
}

/** Mesma regra do banco, para testar sem rede: todas as palavras no nome ou no código. */
export function produtoCasaBusca(p: { nome: string; codigo: string | null }, texto: string): boolean {
  const termos = termosBuscaProduto(texto)
  if (termos.length === 0) return false
  const nome = p.nome.toLowerCase()
  const codigo = (p.codigo ?? '').toLowerCase()
  return termos.every((t) => nome.includes(t.toLowerCase()) || codigo.includes(t.toLowerCase()))
}
