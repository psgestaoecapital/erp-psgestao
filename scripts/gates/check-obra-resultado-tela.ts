// Gate (CEO 08/10 · HB1 fatia 2): a tela Resultado por obra lê v_obra_resultado, só leitura, com erro/vazio/consolidado.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const src = readFileSync('src/app/dashboard/projetos/obras/resultado/page.tsx', 'utf8')

ok(/from\('v_obra_resultado'\)/.test(src), 'lê a view v_obra_resultado')
ok(/\.in\('company_id', companyIds\)/.test(src), 'filtra por empresa selecionada')
ok(!/\.(insert|update|delete|upsert)\(/.test(src), 'só leitura')
ok(/resultado-vazio/.test(src) && /role="alert"/.test(src), 'estados vazio e erro')
ok(/resultado-consolidado/.test(src), 'linha consolidada')
ok(/Baixar Excel/.test(src), 'exporta Excel (CSV)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nResultado por obra (tela): ok')
