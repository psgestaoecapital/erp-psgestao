// Gate (CEO 23/10) — acionar-esteira.yml: espelho da varredura do revisor para a rotina do gilberto-esteira.
// A cada 15 min acorda o Code esteira para varrer o backlog de PRs e destravar; segredo ausente = warning, nunca falha.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const y = readFileSync('.github/workflows/acionar-esteira.yml', 'utf8')
const sc = y.replace(/^\s*#.*$/gm, '')
ok(/cron: '\*\/15 \* \* \* \*'/.test(sc), 'varredura a cada 15 min')
ok(/workflow_dispatch/.test(sc), 'permite disparo manual')
ok(!/\n\s+pull_request(_target)?:/.test(sc), 'não roda por evento de PR (é varredura; o evento já aciona a fila)')
ok(/group: acionar-esteira/.test(sc) && /cancel-in-progress: false/.test(sc), 'grupo próprio, sem auto-cancelamento')
ok(/permissions:[\s\S]*?contents: read/.test(sc) && !/write/.test(sc.split('jobs:')[0]), 'só leitura (não publica por si)')
ok(/secrets\.ESTEIRA_ROTINA_URL/.test(sc) && /secrets\.ESTEIRA_ROTINA_TOKEN/.test(sc), 'segredos ESTEIRA_ROTINA_URL / ESTEIRA_ROTINA_TOKEN')
ok(/::warning[^\n]*Esteira sem rotina/.test(sc) && /exit 0/.test(sc) && !/\bexit 1\b/.test(sc), 'segredo ausente = warning, nunca falha')
ok(/state=open&base=main/.test(sc) && /draft==false/.test(sc) && /index\("nao-publicar"\) == null/.test(sc), 'pendente = PR Ready na main sem nao-publicar')
ok(/pend:-0\}" = "0" \]; then echo "Varredura: nenhuma PR Ready/.test(sc), 'sem PR Ready: sai rápido (não gasta sessão da esteira)')
ok(/Authorization: Bearer \$ESTEIRA_ROTINA_TOKEN/.test(sc) && /anthropic-beta: experimental-cc-routine-2026-04-01/.test(sc)
  && /anthropic-version: 2023-06-01/.test(sc), 'POST no formato do fn_agente_acionar')
ok(/acionar-esteira\.yml/.test(readFileSync('AGENTS.md', 'utf8')), 'AGENTS.md documenta o acionar-esteira.yml')

if (falhas) { console.error(`\n${falhas} falha(s) em acionar-esteira`); process.exit(1) }
console.log('\nAcionar esteira: ok')
