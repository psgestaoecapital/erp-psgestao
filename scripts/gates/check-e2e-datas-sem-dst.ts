/**
 * Gate de build (29/09): os testes de aceitação das pausas (NR-36) gravam horários com -03:00 e comparam com o horário
 * de São Paulo. Em data com horário de verão (Brasil até fev/2019) o 07:42-03:00 vira 08:42 — o veredito de produção
 * da #1922 deu vermelho por isso. Todo teste de pausas que sorteia a data tem de sortear a partir de 2020.
 *   tsx scripts/check-e2e-datas-sem-dst.ts
 */
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const dir = 'e2e/jornadas/aceitacao'
for (const f of readdirSync(dir).filter(x => x.startsWith('nr36-'))) {
  const s = readFileSync(`${dir}/${f}`, 'utf8')
  for (const m of s.matchAll(/Date\.UTC\((\d{4}),[^)]*\)\s*\+\s*\(Math\.floor\(Date\.now\(\) \/ 60000\) % (\d+)\)/g)) {
    const ano = Number(m[1]); const dias = Number(m[2])
    ok(ano >= 2020 && dias <= 366, `${f}: data sorteada em ${ano} (+${dias} dias) — sem horário de verão`)
  }
}
if (falhas) { console.error(`\n[check-e2e-datas-sem-dst] ${falhas} teste(s) sorteando data com horário de verão — build bloqueado.`); process.exit(1) }
console.log('\n[check-e2e-datas-sem-dst] datas dos testes de pausas sem horário de verão.')
