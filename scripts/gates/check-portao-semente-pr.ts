// Gate (INFRA-TESTES Slice 1, 22/10) — o portão de semente no PR é ADITIVO e ISOLADO: banco local efêmero no runner,
// sem segredo de banco, sem produção, sem vaga compartilhada. Checagem estática do workflow e do smoke.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const wf = readFileSync('.github/workflows/portao-semente-pr.yml', 'utf8')
const sm = readFileSync('scripts/banco-testes/smoke.sh', 'utf8')

ok(/pull_request:/.test(wf) && /supabase\/migrations\/\*\*/.test(wf) && /scripts\/banco-testes\/\*\*/.test(wf), 'dispara em PR que toca migration ou a semente')
ok(/supabase start/.test(wf) && /127\.0\.0\.1:54322/.test(wf), 'sobe o Supabase LOCAL efêmero no runner')
ok(!/secrets\./.test(wf), 'não usa nenhum segredo (nem de banco de testes nem de produção)')
ok(!/horsymhsinqcimflrtjo/.test(wf.replace(/#.*$/gm, '')), 'não referencia a produção no código')
ok(!/aceitacao-testes/.test(wf), 'não entra na fila/trava das vagas da aceitação')
ok(/db push --include-all/.test(wf) && /led_max/.test(wf), 'aplica todas as migrations do zero e prova ledger == repo')
ok(/semente\.sql/.test(wf) && /fn_demo_reset/.test(wf) && /smoke\.sh/.test(wf), 'semente + fn_demo_reset + smoke')
ok(/horsymhsinqcimflrtjo/.test(sm) && /exit 1/.test(sm), 'smoke recusa produção/pooler')
for (const v of ['Oficina', 'P&M', 'Revenda', 'Gestão Empresarial', 'Indústria/SST', 'Construção/Hub', 'Mecânica'])
  ok(sm.includes(`vertical ${v}`), `smoke cobre a vertical ${v}`)

if (falhas) { console.error(`\ncheck-portao-semente-pr: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPortão de semente (PR): ok')
