// Gate (CEO 30/09): gates são descobertos pela pasta scripts/gates/ — o "build" do package.json NÃO lista gate um a um
// (era a causa recorrente de conflito entre PRs em fila). Gate novo = arquivo novo aqui; nada a editar no package.json.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
ok(pkg.scripts.build === 'tsx scripts/rodar-gates.ts && next build', `build = rodar-gates + next build (hoje: "${pkg.scripts.build}")`)
ok(!/scripts\/(gates\/)?check-/.test(pkg.scripts.build), 'build não lista gate um a um')
const gates = readdirSync('scripts/gates').filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
ok(gates.length >= 20, `gates na pasta (${gates.length})`)
for (const g of gates) {
  const src = readFileSync(`scripts/gates/${g}`, 'utf8')
  ok(!/from '\.\.\/src\//.test(src), `${g}: import de src com o caminho da pasta (../../src)`)
}

if (falhas) { console.error(`\n${falhas} falha(s) nos gates por pasta`); process.exit(1) }
console.log('\nGates por pasta: ok')
