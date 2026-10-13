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
  // padrão da fila: sem as empresas DEMO (o cabeçalho mostra o mesmo número da aba no padrão)
  const [{ data }, demos] = await Promise.all([
    carregarRascunhos<ItemFila & { id: string; company_id: string | null }>(sb, 'id,company_id,status,resposta,resposta_aprovada,confirmado_pelo_autor'),
    carregarEmpresasDemo(sb),
  ])
  return contarPrecisaDeMim(semDemos(data, demos))
}

// ── Busca (CEO 28/09): número é EXATO — "#286" ou "286" abre só o chamado 286 (antes vinham também os que tinham
// "286" no título/descrição: #172, #174, #175, #184). Texto continua buscando título/descrição.
export const buscaEhNumero = (busca: string) => /^#?\s*\d+$/.test(busca.trim())
export function filtrarBusca<T extends { numero: number; titulo: string | null; descricao: string }>(rows: T[], busca: string): T[] {
  const b = busca.trim()
  if (!b) return rows
  if (buscaEhNumero(b)) { const n = Number(b.replace(/\D/g, '')); return rows.filter((r) => r.numero === n) }
  const t = b.toLowerCase()
  return rows.filter((r) => (r.titulo || '').toLowerCase().includes(t) || (r.descricao || '').toLowerCase().includes(t))
}

// ── Demos (CEO 28/09): chamados das empresas DEMO (robô de aceitação) ficam FORA da fila do CEO por padrão; só entram
// com o filtro "mostrar demos". O cabeçalho "N p/ aprovar" segue o padrão (sem demos) — igual à aba no padrão.
export async function carregarEmpresasDemo(sb: ClienteSupabase): Promise<Set<string>> {
  const r = await sb.from('companies').select('id').eq('is_demo', true)
  return new Set(((r.data ?? []) as { id: string }[]).map((c) => c.id))
}
export const semDemos = <T extends { company_id: string | null }>(rows: T[], demos: Set<string>) =>
  rows.filter((r) => !r.company_id || !demos.has(r.company_id))

// ── Chamados em equipe (SPEC rev. 9 · T1+T2) ──────────────────────────────────────────────────────────────────────
// A carteira define para onde o chamado CAI (responsável); toda a equipe vê "Todos". Um atendente por vez (trava).
export type Visao = 'meus' | 'todos' | 'sem_dono'
export interface ItemEquipe { responsavel_id: string | null; atendente_id: string | null; interno: boolean; company_id: string | null }

// "Meus chamados" = os da minha carteira + os que estou atendendo (inclusive de outra carteira, puxados/direcionados).
export const ehMeu = (it: ItemEquipe, eu: string) => it.responsavel_id === eu || it.atendente_id === eu
// "Sem dono" = empresa cliente sem responsável na carteira (interno e demo ficam fora).
export const semDono = (it: ItemEquipe, demos: Set<string>) =>
  !it.responsavel_id && !it.interno && !!it.company_id && !demos.has(it.company_id)
export function filtrarVisao<T extends ItemEquipe>(rows: T[], visao: Visao, eu: string, demos: Set<string>, responsavel = 'todos'): T[] {
  if (visao === 'meus') return rows.filter((r) => ehMeu(r, eu))
  if (visao === 'sem_dono') return rows.filter((r) => semDono(r, demos))
  return responsavel === 'todos' ? rows : rows.filter((r) => r.responsavel_id === responsavel)
}

// O que a pessoa pode fazer na trava deste chamado (a regra de verdade está no banco; isto só decide os botões).
export interface Trava { livre: boolean; meu: boolean; deOutro: boolean; podeAssumir: boolean; podePuxar: boolean; podeLiberar: boolean; podeDirecionar: boolean }
export function trava(it: ItemEquipe, eu: string, ehCeo: boolean): Trava {
  const livre = !it.atendente_id
  const meu = it.atendente_id === eu
  const deOutro = !livre && !meu
  return {
    livre, meu, deOutro,
    podeAssumir: livre,
    podePuxar: deOutro,
    podeLiberar: meu || (ehCeo && deOutro),
    podeDirecionar: meu || it.responsavel_id === eu || ehCeo,
  }
}
// Puxar com confirmação a mais quando o atendente mexeu há menos de 2 h (o CEO não precisa) — espelho da regra do banco.
export const PUXAR_CONFIRMA_MIN = 120
export const puxarPedeConfirmacao = (ultimoMovimento: string | null, ehCeo: boolean, agora = Date.now()) =>
  !ehCeo && !!ultimoMovimento && (agora - new Date(ultimoMovimento).getTime()) / 60000 < PUXAR_CONFIRMA_MIN
