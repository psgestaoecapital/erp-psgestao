// Gate (P1 17/10) — laço de requisições em agency_timesheet. A leitura do cronômetro aberto é COMPARTILHADA por pessoa
// (1 requisição em voo, resultado vale um intervalo mínimo, só avisarCronometro invalida) e tem disjuntor por minuto.
// Nenhum componente da P&M lê o cronômetro aberto direto do banco: todos passam por lerCronometroAberto.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const lib = readFileSync('src/lib/pm/cronometroGlobal.ts', 'utf8')
ok(/INTERVALO_MIN_LEITURA_MS\s*=\s*\d+/.test(lib), 'intervalo mínimo entre leituras definido')
ok(/LIMITE_LEITURAS_MIN\s*=\s*\d+/.test(lib), 'limite de leituras por minuto (disjuntor) definido')
ok(/if \(leitura\.voo\) return leitura\.voo/.test(lib), 'leituras simultâneas dividem 1 requisição')
ok(/avisarCronometro = \(\) => \{ invalidarLeituraCronometro\(\)/.test(lib), 'início/parada reais invalidam a leitura')
ok(/console\.warn\('\[pm\] cronômetro: laço/.test(lib), 'disjuntor avisa no console')

const sem = ['src/components/pm/BotaoPlay.tsx', 'src/components/pm/Cronometro.tsx', 'src/components/pm/CronometroGlobal.tsx', 'src/components/pm/SugestaoCronometro.tsx']
for (const f of sem) {
  const src = readFileSync(f, 'utf8')
  ok(!/from\(["']agency_timesheet["']\)\.select\(["']id, job_id, inicio_em["']\)/.test(src), `${f} não lê o cronômetro aberto direto do banco`)
}
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
