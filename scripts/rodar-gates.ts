// Roda TODOS os gates do build, descobertos pela pasta scripts/gates/ (CEO 30/09). Antes, cada PR somava um
// "tsx scripts/check-x.ts &&" na linha "build" do package.json e quase toda PR em fila conflitava ali. Agora gate novo =
// um arquivo novo em scripts/gates/ (nome livre, .ts, sem "_" no começo). Nada a editar no package.json.
//
// Cada gate roda num processo próprio (como antes: process.exit, efeitos de topo), em ordem alfabética. Roda todos —
// não para no primeiro vermelho — e no fim lista os que falharam; qualquer vermelho sai com código 1 e quebra o build.
//
//   tsx scripts/rodar-gates.ts            (todos)
//   tsx scripts/rodar-gates.ts etiquetas  (só os que têm "etiquetas" no nome)
import { readdirSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// CEO 22/10 (esteira contínua): um check OBRIGATÓRIO tem que ser LEGÍVEL e LIMITADO. Um gate que trava não pode estourar
// o job inteiro de forma opaca — cada gate tem teto de tempo (POR_GATE_MS), e os culpados vão para o GITHUB_STEP_SUMMARY
// (aparece no check, sem precisar do log). Assim nunca mais ficamos cegos sobre QUAL gate reprovou.
const POR_GATE_MS = Number(process.env.GATE_TIMEOUT_MS || 180000) // 3 min por gate (gate estático sério roda em segundos)

const DIR = join('scripts', 'gates')
const filtro = process.argv[2] ?? ''
const gates = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.startsWith('_') && f.includes(filtro)).sort()
if (gates.length === 0) {
  console.error(`[gates] nenhum gate em ${DIR}${filtro ? ` com "${filtro}"` : ''} — algo está errado`)
  process.exit(1)
}

const tsxLocal = join('node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
const tsx = existsSync(tsxLocal) ? tsxLocal : 'tsx'
const falharam: string[] = []
const t0 = Date.now()
for (const g of gates) {
  const ini = Date.now()
  console.log(`\n── gate: ${g}`)
  const r = spawnSync(tsx, [join(DIR, g)], { stdio: 'inherit', timeout: POR_GATE_MS, killSignal: 'SIGKILL' })
  const ms = Date.now() - ini
  const travou = r.error && (r as { error?: { code?: string } }).error?.code === 'ETIMEDOUT'
  if (r.status !== 0 || travou) {
    falharam.push(travou ? `${g} (TRAVOU > ${POR_GATE_MS / 1000}s)` : g)
    console.error(`✗ ${g} (${ms} ms${travou ? ', TIMEOUT' : ''})`)
  } else console.log(`✓ ${g} (${ms} ms)`)
}
const seg = Math.round((Date.now() - t0) / 1000)
if (falharam.length) {
  const resumo = `[gates] ${falharam.length} de ${gates.length} vermelho(s) em ${seg}s:\n  - ${falharam.join('\n  - ')}`
  console.error(`\n${resumo}`)
  // esteira contínua: nomeia os culpados no resumo do check (aparece no GitHub sem precisar do log, que dá 403)
  const resumoFile = process.env.GITHUB_STEP_SUMMARY
  if (resumoFile) { try { appendFileSync(resumoFile, `### ❌ Gates vermelhos\n\`\`\`\n${resumo}\n\`\`\`\n`) } catch { /* sem summary neste ambiente */ } }
  process.exit(1)
}
console.log(`\n[gates] ${gates.length} gate(s) verdes em ${seg}s`)
