// Gate (P1 estabilidade, 17/10): consulta repetida de usuário/empresas não pode ir ao banco em laço.
import { readFileSync } from 'node:fs'
import { consultaComCache, limparCacheConsultas, LIMITE_POR_MINUTO } from '../../src/lib/cacheConsultaSessao'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

async function main() {
  limparCacheConsultas()
  let n = 0
  const buscar = async () => ++n
  const t0 = 1_000_000
  await Promise.all([consultaComCache('a', buscar, 60_000, t0), consultaComCache('a', buscar, 60_000, t0)])
  ok(n === 1, 'duas montagens simultâneas = 1 consulta (dedupe)')
  for (let i = 0; i < 500; i++) await consultaComCache('a', buscar, 60_000, t0 + i)
  ok(n === 1, '500 montagens dentro do TTL = ainda 1 consulta')
  await consultaComCache('a', buscar, 60_000, t0 + 61_000)
  ok(n === 2, 'depois do TTL consulta de novo')
  // laço com TTL zero: o corte por minuto limita as idas ao banco
  limparCacheConsultas(); n = 0
  for (let i = 0; i < 1000; i++) await consultaComCache('b', buscar, 0, t0 + i)
  ok(n <= LIMITE_POR_MINUTO + 1, `laço de 1000 chamadas em 1 min vira no máximo ${LIMITE_POR_MINUTO + 1} consultas (foram ${n})`)
  // erro não fica em cache
  limparCacheConsultas(); let m = 0
  const falha = async () => { m++; if (m === 1) throw new Error('x'); return m }
  await consultaComCache('c', falha, 60_000, t0).catch(() => {})
  ok((await consultaComCache('c', falha, 60_000, t0 + 1)) === 2, 'falha não é guardada em cache')
  const hook = readFileSync('src/lib/useCompanyIds.ts', 'utf8')
  ok(/consultaComCache\(/.test(hook), 'useCompanyIds usa o cache de consulta')
  if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
  console.log('\nCache de consulta de sessão: ok')
}
void main()
