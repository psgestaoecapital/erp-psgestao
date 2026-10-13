// Roda TODOS os gates do build, descobertos pela pasta scripts/gates/ (CEO 30/09). Antes, cada PR somava um
// "tsx scripts/check-x.ts &&" na linha "build" do package.json e quase toda PR em fila conflitava ali. Agora gate novo =
// um arquivo novo em scripts/gates/ (nome livre, .ts, sem "_" no começo). Nada a editar no package.json.
//
// Cada gate roda num processo próprio (como antes: process.exit, efeitos de topo), em ordem alfabética. Roda todos —
// não para no primeiro vermelho — e no fim lista os que falharam; qualquer vermelho sai com código 1 e quebra o build.
//
//   tsx scripts/rodar-gates.ts            (todos)
//   tsx scripts/rodar-gates.ts etiquetas  (só os que têm "etiquetas" no nome)
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

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
  const r = spawnSync(tsx, [join(DIR, g)], { stdio: 'inherit' })
  const ms = Date.now() - ini
  if (r.status !== 0) { falharam.push(g); console.error(`✗ ${g} (${ms} ms)`) } else console.log(`✓ ${g} (${ms} ms)`)
}
const seg = Math.round((Date.now() - t0) / 1000)
if (falharam.length) {
  console.error(`\n[gates] ${falharam.length} de ${gates.length} vermelho(s) em ${seg}s:\n  - ${falharam.join('\n  - ')}`)
  process.exit(1)
}
console.log(`\n[gates] ${gates.length} gate(s) verdes em ${seg}s`)
