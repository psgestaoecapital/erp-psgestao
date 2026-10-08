// Gate (CEO 08/10): telas novas do Hub só contam como entregues se aparecem no menu/abas do usuário.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const layout = readFileSync('src/app/dashboard/projetos/layout.tsx', 'utf8')
const painel = readFileSync('src/app/dashboard/projetos/page.tsx', 'utf8')
const obras = readFileSync('src/app/dashboard/projetos/obras/page.tsx', 'utf8')
const mig = readdirSync('supabase/migrations').filter((f) => f.endsWith('_hub_menu_resultado_cockpit.sql'))
const sql = mig.length ? readFileSync(`supabase/migrations/${mig[0]}`, 'utf8') : ''

ok(/projetos\/obras\/resultado"/.test(layout), 'aba Resultado no layout do Hub')
ok(/abrir=cockpit/.test(layout), 'aba Cockpit no layout do Hub')
ok(/novidades-hub/.test(painel) && /obras\/resultado/.test(painel) && /abrir=cockpit/.test(painel), 'Painel tem "Novidades do Hub" com os links')
ok(/Abrir cockpit/.test(obras), 'lista de Obras tem "Abrir cockpit" por linha')
ok(/projetos_obra_resultado/.test(sql) && /projetos_obra_cockpit/.test(sql), 'migration cadastra os itens em module_catalog')
ok(/system_screens/.test(sql), 'migration cadastra system_screens')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nHub menu telas novas: ok')
