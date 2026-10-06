// Lógica PURA da esteira de merge (CEO 06/10 "destravar a esteira"). Sem rede, sem I/O: testada pelo gate
// scripts/gates/check-esteira-merge.ts e usada por esteira.ts (CLI do gilberto-revisor e do workflow fila-merge).
import { createHash } from 'node:crypto'

export const LABEL_FILA = 'fila-merge'
export const LABEL_RD941 = 'autorizada-rd-94-1'
const ASSOC_CONFIAVEL = ['OWNER', 'MEMBER']

export type RunPos = { id: number; head_sha: string; status: string; conclusion: string | null }
export type DecisaoPos =
  | { acao: 'liberado'; motivo: string }
  | { acao: 'rerun'; runId: number; motivo: string }
  | { acao: 'esperar'; motivo: string }
  | { acao: 'bloqueado'; motivo: string }

/** (2) PR sem arquivo em supabase/migrations não espera o @pos-migration. */
export const temMigration = (arquivos: string[]) => arquivos.some((f) => f.startsWith('supabase/migrations/'))

/**
 * (1) Veredito do @pos-migration sobre a main. `runs` = runs de "Aceitação @pos-migration" dos commits da main a partir
 * da última migration (inclusive), do mais novo para o mais antigo. Run verde em QUALQUER desses commits libera (o
 * teste roda a suíte inteira contra a produção já com a migration). CANCELADO não é vermelho: re-roda.
 */
export function decidirPosMigration(runs: RunPos[]): DecisaoPos {
  if (runs.some((r) => r.conclusion === 'success')) return { acao: 'liberado', motivo: 'última migration da main já tem @pos-migration verde' }
  const andando = runs.find((r) => r.status !== 'completed')
  if (andando) return { acao: 'esperar', motivo: `@pos-migration em andamento (run ${andando.id})` }
  const falhou = runs.find((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out')
  if (falhou) return { acao: 'bloqueado', motivo: `@pos-migration VERMELHO na main (run ${falhou.id}) — reverter, não re-rodar` }
  const cancelado = runs.find((r) => r.conclusion === 'cancelled')
  if (cancelado) return { acao: 'rerun', runId: cancelado.id, motivo: `@pos-migration cancelado (run ${cancelado.id}) e sem run verde — re-rodar` }
  return { acao: 'esperar', motivo: 'sem run de @pos-migration para a última migration da main (deploy ainda não rodou)' }
}

/**
 * (3) Id de CONTEÚDO da PR: hash só das linhas +/- por arquivo (contexto e números de linha fora), então atualizar a PR
 * com a main mantém o id e mudar o código muda. Entrada: o diff unificado da PR (REST, Accept: application/vnd.github.diff).
 */
export function idConteudo(diff: string): string {
  const h = createHash('sha256')
  let arq = ''
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) { arq = l; h.update(`F ${arq}\n`) }
    else if (l.startsWith('+++ ') || l.startsWith('--- ')) h.update(`${l}\n`)
    else if (/^[+-]/.test(l)) h.update(`${l}\n`)
  }
  return h.digest('hex').slice(0, 40)
}

export type Comentario = { body: string; author_association: string; user?: { login?: string } }

/** Extrai ids de "MERGE AUTORIZADO #N … patch-id: <40 hex>" gravados por quem tem direito (OWNER/MEMBER ou allowlist). */
export function idsAutorizados(comentarios: Comentario[], pr: number, allowlist: string[] = []): string[] {
  const re = new RegExp(`MERGE AUTORIZADO\\s+#${pr}\\b[\\s\\S]*?patch-id\\s*[:=]\\s*\`?([0-9a-f]{40})\``, 'i')
  const ids: string[] = []
  for (const c of comentarios) {
    const confiavel = ASSOC_CONFIAVEL.includes(c.author_association) || allowlist.includes(c.user?.login ?? '')
    const m = confiavel ? c.body.match(re) : null
    if (m) ids.push(m[1].toLowerCase())
  }
  return ids
}

/** (3) A autorização vale se o id de conteúdo atual é igual a um gravado; PR com label RD-94.1 é autorizada por categoria. */
export const autorizada = (idAtual: string, comentarios: Comentario[], pr: number, labels: string[], allowlist: string[] = []) =>
  labels.includes(LABEL_RD941) || idsAutorizados(comentarios, pr, allowlist).includes(idAtual)

export type PrFila = { number: number; draft: boolean; labels: string[]; filaDesde: string }

/** (4) Ordem de chegada: PR aberta, Ready, com a label fila-merge; mais antiga primeiro. */
export const ordemFila = (prs: PrFila[]) =>
  prs.filter((p) => !p.draft && p.labels.includes(LABEL_FILA)).sort((a, b) => a.filaDesde.localeCompare(b.filaDesde) || a.number - b.number)

export type CheckRun = { name: string; status: string; conclusion: string | null }
export type Checks = { pendente: string[]; vermelho: string[]; ok: boolean }
export function resumirChecks(runs: CheckRun[]): Checks {
  const pendente = runs.filter((c) => c.status !== 'completed').map((c) => c.name)
  const vermelho = runs.filter((c) => c.status === 'completed' && !['success', 'skipped', 'neutral'].includes(c.conclusion ?? '')).map((c) => c.name)
  return { pendente, vermelho, ok: runs.length > 0 && !pendente.length && !vermelho.length }
}
