// Gate (CEO 01/10): na fila única de aceitação (grupo demo-e2e), teste de VERSÃO ANTIGA do mesmo ramo é descartado
// sozinho — sem cancelamento manual. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const wf = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
// escopo no JOB aceitacao (a triagem agora tem seu próprio checkout para o prune — não conta aqui)
const passos = wf.slice(wf.indexOf('\n  aceitacao:'))
ok(/'demo-e2e'|group: demo-e2e/.test(wf) && /queue: max/.test(wf), 'fila única entre ramos diferentes continua (demo-e2e, FIFO)')
ok(/actions: write/.test(wf), 'o run tem permissão para cancelar a si mesmo')
ok(passos.indexOf('Versão antiga?') > -1 && passos.indexOf('Versão antiga?') < passos.indexOf('actions/checkout'), 'a checagem de versão antiga é o PRIMEIRO passo do job aceitacao (antes de instalar e testar)')
ok(/commits\/\$SHA\/pulls/.test(wf) && /gh run cancel "\$RUN_ID"/.test(wf), 'compara com o último commit da PR aberta e cancela o próprio run')
ok(/if \[ -n "\$heads" \]/.test(wf), 'commit fora de PR aberta é testado normalmente')

if (falhas) { console.error(`\ncheck-aceitacao-descarta-antiga: ${falhas} falha(s)`); process.exit(1) }
console.log('\nAceitação · versão antiga descartada: ok')
