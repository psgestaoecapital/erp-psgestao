#!/usr/bin/env tsx
// Detector da quarentena de specs @pos-migration (CEO 10/10). Roda NO WORKFLOW aceitacao-pos-migration.yml quando a
// suíte da main falha. Decide, sem supor (RD-38, lê os runs de verdade), se o spec que falhou pode entrar em quarentena:
//
//   spec falhou em 2 runs @pos CONSECUTIVOS da main  E  não é crítico  E  a PR do 1º vermelho NÃO tocou a área do spec
//     → QUARENTENA: abre uma PR (via rápida, só mexe em e2e/quarentena.ts → sem migration) que tira o spec da execução;
//       a fila publica essa PR mesmo com o @pos vermelho (PR sem migration não espera o @pos) e o @pos volta ao verde.
//   senão (regressão da PR, ou crítico, ou 1 falha só) → NÃO quarentena: só registra/alerta; a fila segue segurando.
//
// Nunca apaga o arquivo do spec (fica no repo, só sai da execução). O registro é datado, com motivo e os 2 runs, e com
// o Code dono da área (tarefa). Alerta o CEO/Eng. Chefe por fn_quarentena_registrar (sino + e-mail + briefing).
//
// Ambiente (do workflow): GH_TOKEN (PAT FILA_MERGE_TOKEN), REPO (dono/repo), RUN_ID (run @pos atual, vermelho),
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (para registrar/alertar). Sem esses, o detector só relata e sai 0 (nunca
// derruba o job da aceitação).
import { execFileSync } from 'node:child_process'
import { ehCritico, podeQuarentenar, areaDoSpec, specsEmQuarentena } from '../../e2e/quarentena'

const REPO = process.env.REPO ?? ''
const RUN_ID = process.env.RUN_ID ?? ''
const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const WF = 'aceitacao-pos-migration.yml'

// Code dono por área (prefixo do nome do spec). Carteira: Pdois/Agência → jordana-code; Gean/obras/engenharia →
// rodrigo-code; o resto cai no Eng. Chefe decidir. (Só para a tarefa; não muda a decisão.)
const DONO: Record<string, string> = {
  pm: 'jordana-code', leads: 'jordana-code', agencia: 'jordana-code', pdois: 'jordana-code',
  'mao-obra': 'rodrigo-code', hub: 'rodrigo-code', obra: 'rodrigo-code', hb2: 'rodrigo-code', compras: 'rodrigo-code',
  cliente: 'jordana-code', clientes: 'jordana-code',
}

function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 }).trim()
}
function api(path: string, extra: string[] = []): string {
  return gh(['api', '-H', 'Accept: application/vnd.github+json', path, ...extra])
}

// specs que falharam num run @pos (lê o log do job falho e pega "e2e/.../x.spec.ts" das linhas de erro)
function specsFalhos(runId: string): string[] {
  let log = ''
  try {
    const jobs = JSON.parse(api(`repos/${REPO}/actions/runs/${runId}/jobs`))
    const job = (jobs.jobs ?? []).find((j: { conclusion: string }) => j.conclusion === 'failure') ?? (jobs.jobs ?? [])[0]
    if (!job) return []
    log = gh(['api', `repos/${REPO}/actions/jobs/${job.id}/logs`])
  } catch { return [] }
  const achados = new Set<string>()
  for (const m of log.matchAll(/e2e\/jornadas\/[A-Za-z0-9_./-]+\.spec\.ts/g)) achados.add(m[0])
  return [...achados]
}

// run @pos imediatamente ANTERIOR ao atual na main (para ver se o spec falhou 2x seguidas)
function runAnterior(runIdAtual: string): { id: string; head_sha: string; conclusion: string } | null {
  const runs = JSON.parse(api(`repos/${REPO}/actions/workflows/${WF}/runs?branch=main&per_page=20`)).workflow_runs ?? []
  const idx = runs.findIndex((r: { id: number }) => String(r.id) === String(runIdAtual))
  const ant = idx >= 0 ? runs[idx + 1] : runs[1]
  return ant ? { id: String(ant.id), head_sha: ant.head_sha, conclusion: ant.conclusion } : null
}

// arquivos da PR daquele head (o 1º vermelho). Sem PR associada → [] (trata como "não tocou", mas a decisão ainda
// exige não-crítico; na dúvida o revisor decide).
function arquivosDaPrDoHead(sha: string): string[] {
  try {
    const prs = JSON.parse(api(`repos/${REPO}/commits/${sha}/pulls`))
    const n = prs?.[0]?.number
    if (!n) return []
    const files = JSON.parse(api(`repos/${REPO}/pulls/${n}/files?per_page=100`))
    return (files ?? []).map((f: { filename: string }) => f.filename)
  } catch { return [] }
}

function registrar(spec: string, area: string, code: string, motivo: string, runs: [string, string], quarentenado: boolean): void {
  if (!SUPABASE_URL || !SERVICE_KEY) { console.log('· sem SUPABASE_URL/SERVICE_KEY: pulo o registro/alerta (só relato)'); return }
  const body = JSON.stringify({ p_spec: spec, p_area: area, p_code: code, p_motivo: motivo, p_runs: runs, p_quarentenado: quarentenado })
  try {
    execFileSync('curl', ['-fsS', '-X', 'POST', `${SUPABASE_URL}/rest/v1/rpc/fn_quarentena_registrar`,
      '-H', `apikey: ${SERVICE_KEY}`, '-H', `Authorization: Bearer ${SERVICE_KEY}`, '-H', 'Content-Type: application/json',
      '-d', body], { encoding: 'utf8' })
    console.log(`· registrado/alertado: ${spec} (quarentenado=${quarentenado})`)
  } catch (e) { console.log(`· falha ao registrar (não derruba o job): ${(e as Error).message}`) }
}

// Abre a PR (via rápida, sem migration) que inclui o spec na quarentena — a fila a publica mesmo com o @pos vermelho.
function abrirPrQuarentena(entradas: { spec: string; area: string; code: string; motivo: string; runs: [string, string] }[]): void {
  const ref = `claude/quarentena-auto-${RUN_ID}`
  const main = api(`repos/${REPO}/git/ref/heads/main`)
  const mainSha = JSON.parse(main).object.sha
  try { api(`repos/${REPO}/git/refs`, ['-X', 'POST', '-f', `ref=refs/heads/${ref}`, '-f', `sha=${mainSha}`]) } catch { /* já existe */ }
  const arq = 'e2e/quarentena.ts'
  const atual = JSON.parse(api(`repos/${REPO}/contents/${arq}?ref=${ref}`))
  let texto = Buffer.from(atual.content, 'base64').toString('utf8')
  const bloco = entradas.map((e) => `  { spec: '${e.spec}', area: '${e.area}', motivo: ${JSON.stringify(e.motivo)}, desde: '${new Date().toISOString()}', runs: [${e.runs[0]}, ${e.runs[1]}], code: '${e.code}' },`).join('\n')
  texto = texto.replace('/* quarentena:inicio */', `/* quarentena:inicio */\n${bloco}`)
  api(`repos/${REPO}/contents/${arq}`, ['-X', 'PUT', '-f', `message=quarentena automática: ${entradas.map((e) => e.spec.split('/').pop()).join(', ')} (@pos run ${RUN_ID})`,
    '-f', `content=${Buffer.from(texto).toString('base64')}`, '-f', `branch=${ref}`, '-f', `sha=${atual.sha}`])
  const corpo = `Quarentena automática (CEO 10/10). Specs que falharam 2× seguidas no @pos-migration da main, **sem relação com a PR do 1º vermelho** e **não-críticos**:\n\n${entradas.map((e) => `- \`${e.spec}\` — ${e.motivo} (Code dono: ${e.code})`).join('\n')}\n\nSó mexe em \`e2e/quarentena.ts\` (sem migration): a fila publica via rápida e o @pos volta ao verde. O arquivo do spec continua no repo; sai da quarentena quando o Code dono consertar.\n\nCode: rodrigo-code\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`
  const pr = JSON.parse(api(`repos/${REPO}/pulls`, ['-X', 'POST', '-f', `title=quarentena automática de spec @pos (run ${RUN_ID})`, '-f', `head=${ref}`, '-f', 'base=main', '-f', `body=${corpo}`]))
  console.log(`· PR de quarentena aberta: #${pr.number}`)
}

function main(): void {
  if (!REPO || !RUN_ID) { console.log('sem REPO/RUN_ID: nada a fazer'); return }
  const atuais = specsFalhos(RUN_ID)
  if (!atuais.length) { console.log('não achei spec falho no run atual (talvez falha fora de teste): nada a quarentenar'); return }
  const ant = runAnterior(RUN_ID)
  if (!ant || ant.conclusion !== 'failure') { console.log('run @pos anterior não é vermelho: 1 falha só, não quarentena (segura a fila)'); return }
  const antes = specsFalhos(ant.id)
  const doisSeguidos = atuais.filter((s) => antes.includes(s))
  if (!doisSeguidos.length) { console.log('nenhum spec falhou 2× seguidas: não quarentena (segura a fila)'); return }

  const prFiles = arquivosDaPrDoHead(ant.head_sha)  // a PR do 1º vermelho da sequência
  const jaQuarentenados = new Set(specsEmQuarentena())
  const aQuarentenar: { spec: string; area: string; code: string; motivo: string; runs: [string, string] }[] = []
  for (const spec of doisSeguidos) {
    if (jaQuarentenados.has(spec)) continue
    const area = areaDoSpec(spec)
    const code = DONO[area] ?? DONO[area.split('-')[0]] ?? 'eng_chefe'
    const d = podeQuarentenar(spec, prFiles)
    const motivo = `falhou 2× seguidas no @pos da main (runs ${ant.id} e ${RUN_ID}); ${d.motivo}`
    if (d.ok) { aQuarentenar.push({ spec, area, code, motivo, runs: [ant.id, RUN_ID] }); registrar(spec, area, code, motivo, [ant.id, RUN_ID], true) }
    else { console.log(`· ${spec}: NÃO quarentena — ${d.motivo} (segura a fila)`); registrar(spec, area, code, motivo, [ant.id, RUN_ID], false) }
  }
  if (aQuarentenar.length) abrirPrQuarentena(aQuarentenar)
  else console.log('nada elegível para quarentena nesta rodada')
}

main()
