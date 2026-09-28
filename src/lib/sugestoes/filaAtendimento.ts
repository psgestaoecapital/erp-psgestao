// Fila de chamados (/dashboard/atendimento) — regras puras, testadas no build (scripts/check-fila-atendimento.ts).
//
// Regra do CEO (28/09, ajustada): "Precisa de mim" = resposta escrita e NÃO aprovada, em chamado ABERTO (qualquer
// status, menos concluído e arquivado). O cabeçalho "N p/ aprovar" usa exatamente a mesma regra (contarPrecisaDeMim).
// Rascunho em chamado já encerrado NÃO some (RD-30 — nada é apagado): fica no histórico do chamado marcado
// "rascunho não enviado — chamado já encerrado" e fora da fila; se o chamado for reaberto, volta sozinho para a aba.
// Antes: o status terminal vinha primeiro e a tela carregava só 300 linhas sem ordem — o #286 (aguardando) e o #135
// (nova) sumiram da aba enquanto o cabeçalho, por outra consulta, contava 2.

export const TERMINAIS = ['concluida', 'concluido', 'resolvida', 'implementado', 'recusada', 'duplicada', 'arquivada']
// encerrado para efeito de rascunho: concluído ou arquivado (CEO) — os demais status contam como aberto
export const ENCERRADOS = ['concluida', 'concluido', 'arquivada']
export type EstadoFila = 'precisa_mim' | 'sem_confirmacao' | 'em_curso' | 'terminal'

export interface ItemFila { status: string; resposta: string | null; resposta_aprovada: boolean; confirmado_pelo_autor: boolean }

export const temRascunho = (it: Pick<ItemFila, 'resposta' | 'resposta_aprovada'>) =>
  !!(it.resposta && it.resposta.trim()) && !it.resposta_aprovada

export const chamadoEncerrado = (it: Pick<ItemFila, 'status'>) => ENCERRADOS.includes(it.status)

// Rascunho que nunca foi enviado e cujo chamado já encerrou — rótulo no histórico, fora da fila.
export const RASCUNHO_NAO_ENVIADO = 'Rascunho não enviado — chamado já encerrado'
export const rascunhoNaoEnviado = (it: ItemFila) => temRascunho(it) && chamadoEncerrado(it)

export function estadoFila(it: ItemFila): EstadoFila {
  if (temRascunho(it) && !chamadoEncerrado(it)) return 'precisa_mim'           // ⏳ depende do CEO — chamado aberto
  if (TERMINAIS.includes(it.status)) return 'terminal'
  if (it.resposta_aprovada && !it.confirmado_pelo_autor) return 'sem_confirmacao' // 📤 esperando o autor
  return 'em_curso'                                                              // 🔵 sem resposta ainda
}

// A tela carrega a fila em duas consultas e junta: (1) os chamados mais recentes, ORDENADOS (nunca um corte
// arbitrário), e (2) TODOS os rascunhos, sem limite — um rascunho nunca pode ficar de fora por causa do corte.
export const FILA_LIMITE = 1000
export function juntarFila<T extends { id: string }>(recentes: T[], rascunhos: T[]): T[] {
  const porId = new Map<string, T>()
  for (const r of recentes) porId.set(r.id, r)
  for (const r of rascunhos) porId.set(r.id, r)
  return Array.from(porId.values())
}

// UMA contagem para os dois lugares (CEO 28/09: o cabeçalho "N p/ aprovar" da Central de Melhorias e a aba
// "Precisa de mim" da fila têm de mostrar SEMPRE o mesmo número). Os dois leem os rascunhos pela mesma consulta
// e contam com a mesma regra (estadoFila).
export const contarPrecisaDeMim = (rows: ItemFila[]) => rows.filter((r) => estadoFila(r) === 'precisa_mim').length

// Consultas da fila (as mesmas no cabeçalho, na tela e no teste de aceitação).
type ClienteSupabase = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
export async function carregarRascunhos<T extends ItemFila & { id: string }>(sb: ClienteSupabase, colunas = '*'): Promise<{ data: T[]; error: { message: string } | null }> {
  const r = await sb.from('v_sugestao_fila').select(colunas).eq('resposta_aprovada', false).not('resposta', 'is', null)
  return { data: (r.data ?? []) as T[], error: r.error ?? null }
}
export async function carregarFila<T extends ItemFila & { id: string }>(sb: ClienteSupabase): Promise<{ data: T[]; error: { message: string } | null }> {
  const [rec, ras] = await Promise.all([
    sb.from('v_sugestao_fila').select('*').order('created_at', { ascending: false }).limit(FILA_LIMITE),
    carregarRascunhos<T>(sb),
  ])
  const error = rec.error ?? ras.error
  return { data: error ? [] : juntarFila((rec.data ?? []) as T[], ras.data), error: error ?? null }
}
export async function contarPendentesAprovacao(sb: ClienteSupabase): Promise<number> {
  const { data } = await carregarRascunhos<ItemFila & { id: string }>(sb, 'id,status,resposta,resposta_aprovada,confirmado_pelo_autor')
  return contarPrecisaDeMim(data)
}
