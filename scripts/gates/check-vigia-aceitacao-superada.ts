// Gate (Eng. Chefe 08/10; CEO 10/10) — o vigia libera a vaga única cancelando aceitação de PREVIEW que a ocupa à toa:
// PR mergeada/fechada ou SHA superado/órfão. Desde 10/10 a lógica vive em scripts/merge/aceitacao-prune.sh (chamado
// também pela triagem) e passou a incluir os runs status=in_progress PRESOS na fila de concorrência (onde ficavam 2h
// até o zumbi matar aos 90 min). A versão VIVA de PR aberta e o run da main nunca são cancelados — provado em
// check-aceitacao-prune.ts. Usa o GITHUB_TOKEN do job (actions: write).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const y = readFileSync('.github/workflows/vigia-runs.yml', 'utf8')
const passo = y.slice(y.indexOf('Liberar vaga'), y.indexOf('Re-rodar aceitação cancelada'))

ok(passo.length > 40, 'passo "Liberar vaga" existe no vigia')
ok(/actions: write/.test(y), 'vigia tem actions: write')
ok(/scripts\/merge\/aceitacao-prune\.sh/.test(passo), 'delega a lógica ao prune compartilhado (mesma da triagem)')
ok(!/FILA_MERGE_TOKEN/.test(passo), 'usa o GITHUB_TOKEN do job (não o PAT da fila)')
// o prune, de fato, protege a versão viva e inclui os presos na fila (in_progress)
const sh = readFileSync('scripts/merge/aceitacao-prune.sh', 'utf8')
ok(/for st in queued waiting in_progress/.test(sh), 'o prune inclui in_progress (os runs presos na fila de concorrência)')
ok(/select\([^)]*state=="open"[^)]*head\.sha=="\$hsha"/.test(sh.replace(/\\"/g, '"')), 'o prune só cancela quando NÃO há versão viva (open & head atual) — nunca a viva')

if (falhas) { console.error(`\ncheck-vigia-aceitacao-superada: ${falhas} falha(s)`); process.exit(1) }
console.log('\nVigia de aceitação superada: ok')
