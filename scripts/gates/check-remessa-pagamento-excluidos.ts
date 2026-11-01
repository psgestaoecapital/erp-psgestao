// Gate (#3267): a montagem da remessa de pagamentos não pode listar título excluído (erp_pagar.deleted_at),
// nem pago/cancelado — só aberto/vencido. Estático, sem rede: confere a consulta da tela.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const src = readFileSync('src/app/dashboard/financeiro/remessa-pagamento/page.tsx', 'utf8')
const m = src.match(/const \{ data: tit \} = await supabase\.from\('erp_pagar'\)[\s\S]*?\.limit\(\d+\)/)
const q = m ? m[0] : ''
ok(!!q, 'consulta dos títulos da remessa encontrada')
ok(/\.is\('deleted_at', null\)/.test(q), 'remessa ignora título excluído (deleted_at IS NULL)')
ok(/\.in\('status', \['aberto', 'vencido'\]\)/.test(q), 'remessa só lista aberto/vencido (pago e cancelado fora)')
ok(q.indexOf(".is('deleted_at'") < q.indexOf('.limit('), 'filtro de excluído vem antes do limite')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
