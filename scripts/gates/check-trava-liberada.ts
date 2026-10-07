// Gate (CEO 07/10): a trava da demo é sempre liberada ao fim da aceitação, inclusive em cancelamento/timeout.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => readFileSync(p, 'utf8')

ok(/soltarTravaDemo\(donoTrava\(\)\)/.test(ler('scripts/e2e-trava-soltar.ts')), 'script solta a trava do dono do run')
for (const f of ['aceitacao-pr.yml', 'aceitacao-pos-migration.yml']) {
  const wf = ler(`.github/workflows/${f}`)
  ok(/if: always\(\)\s*\n\s*(continue-on-error: true\s*\n\s*)?env:[\s\S]{0,900}?npx tsx scripts\/e2e-trava-soltar\.ts/.test(wf),
    `${f}: passo final always() solta a trava da demo`)
}
if (falhas) process.exit(1)
