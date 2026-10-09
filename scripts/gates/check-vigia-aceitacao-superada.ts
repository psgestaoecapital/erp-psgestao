// Gate (Eng. Chefe 08/10) — o vigia cancela aceitação de PREVIEW esperando a fila cujo SHA não é mais o head da PR
// (ou cuja PR fechou/virou draft), com o GITHUB_TOKEN do workflow (actions: write). Run executando nunca é cancelado aqui.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const y = readFileSync('.github/workflows/vigia-runs.yml', 'utf8')
const passo = y.slice(y.indexOf('Cancelar aceitação de preview superada'), y.indexOf('Re-rodar aceitação cancelada'))

ok(passo.length > 100, 'passo "Cancelar aceitação de preview superada" existe')
ok(/actions: write/.test(y), 'vigia tem actions: write')
ok(/workflows\/aceitacao-pr\.yml\/runs\?status=\$st/.test(passo) && /for st in pending queued waiting/.test(passo), 'olha só runs esperando a fila (pending/queued/waiting)')
ok(!/in_progress/.test(passo), 'nunca toca run em execução')
ok(/commits\/\$sha\/pulls/.test(passo) && /\.draft == false/.test(passo) && /\.head\.sha == /.test(passo), 'SHA vale só se for o head de PR aberta e Ready')
ok(/\[ "\$vale" = 0 \] \|\| continue/.test(passo), 'erro de consulta à API não cancela nada')
ok(!/FILA_MERGE_TOKEN/.test(passo), 'usa o GITHUB_TOKEN do job')

if (falhas) { console.error(`\ncheck-vigia-aceitacao-superada: ${falhas} falha(s)`); process.exit(1) }
console.log('\nVigia de aceitação superada: ok')
