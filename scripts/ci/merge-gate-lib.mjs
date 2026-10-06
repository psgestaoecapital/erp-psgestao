// Regras puras do gate de merge (CEO 06/10, "destravar a esteira"). Sem rede e sem git: quem chama passa os dados.
// Usado pela fila de merge (.github/workflows/fila-merge.mjs → fila-merge.yml) e pelo gate scripts/gates/check-merge-gate.ts.

const OK = new Set(['success', 'neutral', 'skipped'])

/** Arquivos de migration tocados pela PR? (regra 2: PR sem migration não espera o @pos-migration) */
export const temMigration = (arquivos) => arquivos.some((f) => /^supabase\/migrations\/.+\.sql$/.test(f))

/**
 * Regra 3 — a autorização vale para o CONTEÚDO (patch-id), não para o SHA. O comentário do revisor traz
 * "MERGE AUTORIZADO #N" e "patch-id: <40 hex>". Vale o comentário mais recente de um autorizador com essa frase.
 * Atualizar com a main não muda o patch-id; mudar o código da PR muda → nova revisão.
 */
export function autorizacaoValida({ comentarios, pr, autorizadores, patchIdAtual }) {
  const re = new RegExp(`MERGE AUTORIZADO\\s*#${pr}\\b`, 'i')
  const lista = comentarios
    .filter((c) => autorizadores.includes((c.user ?? '').toLowerCase()) && re.test(c.body ?? ''))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const ultimo = lista[lista.length - 1]
  if (!ultimo) return { ok: false, motivo: 'sem comentário MERGE AUTORIZADO de autorizador' }
  const m = /patch-id:\s*([0-9a-f]{40})/i.exec(ultimo.body)
  if (!m) return { ok: false, motivo: 'autorização sem patch-id (revisor deve gravar o patch-id no comentário)' }
  if (m[1].toLowerCase() !== String(patchIdAtual).toLowerCase())
    return { ok: false, motivo: 'o código da PR mudou depois da autorização (patch-id diferente) — nova revisão' }
  return { ok: true, motivo: 'autorizada para este conteúdo' }
}

/** Checks da PR: tudo concluído e verde (success/neutral/skipped). Devolve 'verde' | 'esperar' | 'vermelho'. */
export function estadoChecks(checkRuns) {
  if (checkRuns.length === 0) return 'esperar'
  if (checkRuns.some((c) => c.status !== 'completed')) return 'esperar'
  return checkRuns.every((c) => OK.has(c.conclusion)) ? 'verde' : 'vermelho'
}

/**
 * Regras 1 e 2 — @pos-migration.
 *  - PR sem migration: libera (exige só gates + Vercel + aceitação, que entram em estadoChecks).
 *  - PR com migration: olha a ÚLTIMA migration da main e os runs do aceitacao-pos-migration desse commit.
 *      verde → libera · rodando → espera · CANCELADO não é vermelho: re-roda (rerun do run cancelado) ·
 *      falhou de verdade → bloqueia · sem run algum → espera (o deploy-migrations ainda não terminou).
 * runs: [{id, status, conclusion, created_at}] do workflow aceitacao-pos-migration.yml com head_sha = última migration.
 */
export function decidirPosMigration({ prTemMigration, runs }) {
  if (!prTemMigration) return { acao: 'liberar', motivo: 'PR sem migration não espera o @pos-migration' }
  if (runs.some((r) => r.status === 'completed' && r.conclusion === 'success'))
    return { acao: 'liberar', motivo: 'última migration da main já tem @pos-migration verde' }
  if (runs.some((r) => r.status !== 'completed')) return { acao: 'esperar', motivo: '@pos-migration em andamento' }
  const ult = [...runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  if (!ult) return { acao: 'esperar', motivo: 'ainda sem run do @pos-migration para a última migration da main' }
  if (ult.conclusion === 'cancelled') return { acao: 'rerodar', runId: ult.id, motivo: 'run cancelado não é vermelho: re-rodar' }
  return { acao: 'bloquear', motivo: `@pos-migration ${ult.conclusion} na última migration da main` }
}

/** Escolhe a próxima PR da fila: label fila-merge, ordem de chegada (momento em que a label entrou). */
export const proximaDaFila = (prs) => [...prs].sort((a, b) => String(a.fila_desde).localeCompare(String(b.fila_desde)))[0] ?? null

/** RD-94.1 (categoria a): PR só de workflow/gates/testes/docs dispensa a mensagem de autorização do Eng. Chefe. */
export const somenteWorkflowGatesDocs = (arquivos) =>
  arquivos.length > 0 && arquivos.every((f) => /^(\.github\/workflows\/|scripts\/gates\/|scripts\/ci\/|e2e\/|AGENTS\.md$|CLAUDE\.md$|.+\.md$)/.test(f))
