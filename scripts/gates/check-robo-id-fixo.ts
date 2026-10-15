// Gate (Eng. Chefe 15/10): o id fixo do robô (74cf7dfa-…) é só do robô. Causa: Montar #329 caiu na semente porque
// "robo-demo@testes.local" ocupava o id → "criar robô (id fixo): HTTP 500".
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const ROBO = '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'
const wf = readFileSync('.github/workflows/montar-banco-testes.yml', 'utf8')
ok(/id fixo do robô ocupado por outro e-mail/.test(wf) && /where id = '\$ROBO_ID' and lower\(email\) <> lower/.test(wf),
  'montar-banco-testes: semente apaga o ocupante do id fixo quando o e-mail é outro')
ok(/robô não convergiu para o id fixo/.test(wf), 'montar-banco-testes: trava de convergência mantida')

// Nenhum script/spec pode inserir em auth.users com o id fixo do robô (as migrations de semente só o referenciam).
const varre = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) varre(p, out)
    else if (/\.(ts|sh|sql|yml)$/.test(n)) out.push(p)
  }
  return out
}
const indevidos = [...varre('scripts/banco-testes'), ...varre('e2e')].filter((f) => {
  const s = readFileSync(f, 'utf8')
  return s.includes(ROBO) && /insert\s+into\s+auth\.users/i.test(s)
})
ok(indevidos.length === 0, `id fixo do robô não é inserido em auth.users fora do Montar${indevidos.length ? ': ' + indevidos.join(', ') : ''}`)

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nId fixo do robô: ok')
