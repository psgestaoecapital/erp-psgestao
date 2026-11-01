// Gate (PDCA, CEO 09/10): o workflow noturno do PDCA roda o executor, entra na fila da demo e não usa Playwright em empresa real. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const wf = readFileSync('.github/workflows/pdca-noturno.yml', 'utf8')

ok(/schedule:\s*\n\s*- cron:/.test(wf) && /workflow_dispatch:/.test(wf), 'pdca-noturno: cron + disparo manual')
ok(/group: demo-e2e/.test(wf) && /queue: max/.test(wf), 'pdca-noturno: entra na fila única da demo (demo-e2e)')
ok(/rpc\/fn_pdca_jornadas_executar/.test(wf), 'pdca-noturno: chama fn_pdca_jornadas_executar')
ok(/vw_pdca_jornada_placar/.test(wf), 'pdca-noturno: publica o placar por vertical')
ok(/timeout-minutes: \d+/.test(wf), 'pdca-noturno: job com timeout')

if (falhas) process.exit(1)
