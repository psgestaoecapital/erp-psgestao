// Gate (CEO 30/09 · "é a terceira vez que PR fica vermelha só por esperar mais de 30 minutos"). Roda no build, sem rede:
// todo workflow que roda Playwright na demonstração (playwright test / jornadas:revenda) tem o job na MESMA fila do
// GitHub — concurrency group 'demo-e2e', queue: max, cancel-in-progress: false. Assim os runs esperam a vez em FIFO fora
// do runner, e a trava no banco (pegarTravaDemo) fica só de segunda guarda. Workflow novo de e2e fora da fila quebra aqui.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// Sem biblioteca de YAML (dependência nova no build): recorta cada job pelo recuo de 2 espaços em "jobs:".
const DIR = '.github/workflows'
let comDemo = 0
for (const f of readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n))) {
  const txt = readFileSync(join(DIR, f), 'utf8')
  const iJobs = txt.search(/^jobs:\s*$/m)
  if (iJobs < 0) continue
  const jobs = txt.slice(iJobs).split(/\n(?=  [A-Za-z0-9_-]+:\s*$)/m).slice(1)
  for (const bloco of jobs) {
    const nome = bloco.match(/^  ([A-Za-z0-9_-]+):/)?.[1] ?? '?'
    if (!/playwright test|jornadas:revenda/.test(bloco)) continue
    comDemo++
    const c = bloco.match(/^    concurrency:\s*\n((?:      .*\n?)+)/m)?.[1] ?? ''
    ok(/^      group: demo-e2e\s*$/m.test(c) && /^      queue: max\s*$/m.test(c) && !/cancel-in-progress: true/.test(c),
      `${f} › ${nome}: na fila da demo (group demo-e2e, queue: max, sem cancelar)`)
  }
}
ok(comDemo >= 4, `os workflows de e2e da demo foram encontrados (${comDemo}: aceitação preview, pós-migration, jornadas e juiz)`)

if (falhas) { console.error(`\n${falhas} falha(s) na fila da demo`); process.exit(1) }
console.log('\nFila da demo: ok')
