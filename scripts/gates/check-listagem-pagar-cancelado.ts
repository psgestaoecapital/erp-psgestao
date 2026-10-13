// Gate (#2734) — fn_ge_listagem_v2: o ramo 'pagar' não pode somar/listar lançamentos CANCELADOS.
import { readFileSync, readdirSync } from 'node:fs'

const dir = 'supabase/migrations'
const arqs = readdirSync(dir).filter((f) => readFileSync(`${dir}/${f}`, 'utf8').includes('FUNCTION public.fn_ge_listagem_v2')).sort()
const ultima = readFileSync(`${dir}/${arqs[arqs.length - 1]}`, 'utf8')
const ramoPagar = ultima.slice(ultima.indexOf("IF p_tipo = 'pagar'"), ultima.indexOf('ELSE\n    SELECT'))

const n = (ramoPagar.match(/COALESCE\((d\.)?status, ''\) <> 'cancelado'/g) ?? []).length
if (n < 3) { console.error(`✗ ramo pagar: esperado filtro de cancelado nos 3 SELECTs (KPIs, vencidos, lista), achei ${n}`); process.exit(1) }
console.log('✓ listagem pagar exclui cancelado em KPIs, vencidos e lista')
