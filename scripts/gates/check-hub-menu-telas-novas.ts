// Gate (CEO 08/10): entrega do Hub só conta se aparece no menu/aba — Resultado por obra e Cockpit da obra.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const layout = readFileSync('src/app/dashboard/projetos/layout.tsx', 'utf8')
const painel = readFileSync('src/app/dashboard/projetos/page.tsx', 'utf8')
const obras = readFileSync('src/app/dashboard/projetos/obras/page.tsx', 'utf8')
const mig = readdirSync('supabase/migrations').filter((f) => f.endsWith('_hub_menu_resultado_cockpit.sql'))
const sql = mig.length ? readFileSync(`supabase/migrations/${mig[0]}`, 'utf8') : ''

ok(/obras\/resultado", label: "Resultado"/.test(layout), 'aba Resultado no layout do Hub')
ok(/label: "Cockpit"/.test(layout), 'aba Cockpit no layout do Hub')
ok(/data-testid="novidades-hub"/.test(painel) && /obras\/resultado/.test(painel), 'bloco Novidades do Hub no painel')
ok(/Abrir cockpit/.test(obras), 'botão Abrir cockpit em cada obra')
ok(/projetos_obras_resultado/.test(sql) && /projetos_obras_cockpit/.test(sql), 'menu do banco (module_catalog)')
ok(/system_screens/.test(sql), 'telas cadastradas em system_screens')
ok(mig.length === 1 && /^\d{12}05_/.test(mig[0]), 'migration com segundos 05')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nHub menu telas novas: ok')
