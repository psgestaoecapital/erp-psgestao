// O PostgREST do Supabase devolve no máximo 1000 linhas por requisição (max-rows), MESMO com .limit(5000).
// Quem precisa da lista inteira (ex.: estoque com 1485 itens — chamado #126) busca em páginas com .range().
// A consulta montada precisa ter ordem determinística (ex.: .order('nome').order('id')), senão páginas
// vizinhas podem repetir/pular linha.

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export const TAMANHO_PAGINA_POSTGREST = 1000

export async function selecionarTodas<T>(
  montar: (de: number, ate: number) => Pagina<T>,
  opts: { pagina?: number; teto?: number } = {},
): Promise<{ data: T[]; error: { message: string } | null }> {
  const pagina = opts.pagina ?? TAMANHO_PAGINA_POSTGREST
  const teto = opts.teto ?? 50000
  const todas: T[] = []
  for (let de = 0; de < teto; de += pagina) {
    const { data, error } = await montar(de, de + pagina - 1)
    if (error) return { data: todas, error }
    const lote = data ?? []
    todas.push(...lote)
    if (lote.length < pagina) break
  }
  return { data: todas, error: null }
}
