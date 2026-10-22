// Gate (CEO 08/10 · HB2 fatia 1): assistente "Nova obra" cria pela RPC do banco e abre o cockpit; sem escrita direta em tabela.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const src = readFileSync('src/app/dashboard/projetos/obras/nova/page.tsx', 'utf8')
const lista = readFileSync('src/app/dashboard/projetos/obras/page.tsx', 'utf8')

ok(/rpc\('fn_hub_criar_obra_rapida'/.test(src), 'cria pela RPC fn_hub_criar_obra_rapida')
ok(!/\.from\(/.test(src), 'sem escrita direta em tabela')
ok(/\/cockpit\?area=hub/.test(src), 'abre o cockpit da obra criada')
ok(/role="alert"/.test(src) && /nova-obra-salvar/.test(src), 'erro visível e botão de salvar')
ok(/link-nova-obra/.test(lista), 'lista de obras tem o atalho + Nova obra')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nNova obra (tela): ok')
