// Gate (#2244, Pdois): fn_agendamento_mudar_status existe com 2 e 3 argumentos (a de 3 com p_motivo DEFAULT NULL,
// 20260909230000). Chamada RPC só com p_id/p_status é ambígua no Postgres ("could not choose the best candidate
// function") e a tarefa não conclui. Toda chamada no front manda p_motivo explicitamente.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivos(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : []
  })
}

let chamadas = 0
for (const f of arquivos('src')) {
  const s = readFileSync(f, 'utf8')
  for (const m of s.matchAll(/rpc\(\s*'fn_agendamento_mudar_status'\s*,\s*\{([^}]*)\}/g)) {
    chamadas++
    ok(/\bp_motivo\s*:/.test(m[1]), `${f}: fn_agendamento_mudar_status com p_motivo explícito`)
  }
}
ok(chamadas >= 2, `chamadas encontradas (${chamadas}) — Oficina e P&M`)
if (falhas) process.exit(1)
