// Gate (12/10, passada de semente): o "Montar banco de testes" RECRIA/repovoa o banco da vaga 0, então precisa esperar
// na MESMA fila FIFO da aceitação (aceitacao-testes) — antes tinha grupo próprio e rodava no meio da aceitação da main
// (run 196: 84 specs vermelhos por dado ausente; montar 204 rodou dentro do run). Sem rede, banco ou variável.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗ ' + msg) } else console.log('✓ ' + msg) }
const ler = (f: string) => readFileSync(f, 'utf8')

const montar = ler('.github/workflows/montar-banco-testes.yml')
const pr = ler('.github/workflows/aceitacao-pr.yml')
const main = ler('.github/workflows/aceitacao-main.yml')

const grupoMontar = /^concurrency:\s*\n\s+group: ([^\n]+)\n\s+cancel-in-progress: false\n\s+queue: max/m.exec(montar)
ok(!!grupoMontar, 'montar-banco-testes: concurrency com grupo, sem cancelar, queue: max')
ok(!!grupoMontar && /'aceitacao-testes'/.test(grupoMontar[1]) && !/group: montar-banco-testes/.test(montar),
  'montar-banco-testes: vaga 0 espera no grupo aceitacao-testes (o mesmo da aceitação de PR na vaga 0)')
ok(!!grupoMontar && /aceitacao-testes-\{0\}/.test(grupoMontar[1]) && /inputs\.vaga/.test(grupoMontar[1]),
  'montar-banco-testes: vagas extras têm grupo próprio por vaga (vaga 1 = aceitacao-testes-1, o mesmo da aceitação da main)')
// CEO 18/10: a aceitação da main passou para a vaga 1 → compartilha o banco (grupo aceitacao-testes-1) com o montar/reconciliar da vaga 1.
ok(/group: aceitacao-testes-1\s*\n/.test(main), 'aceitacao-main: grupo aceitacao-testes-1 (vaga 1 — o mesmo do montar/reconciliar da vaga 1)')
ok(/needs\.triagem\.outputs\.vaga == '0' && 'aceitacao-testes'/.test(pr),
  'aceitacao-pr: vaga 0 usa o MESMO grupo aceitacao-testes (PR e main não disputam o banco)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-montar-na-fila-do-banco: ok')
