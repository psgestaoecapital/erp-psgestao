// Gate — Mapa da Infra (aba Codes, CEO 14/10), fatia 1: desenho esperado no banco. Estático, sem rede.
import { readdirSync, readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const arq = readdirSync('supabase/migrations').find((f) => f.endsWith('_infra_mapa_desenho_esperado.sql'))
ok(!!arq, 'migration do desenho esperado existe')
const sql = arq ? readFileSync(`supabase/migrations/${arq}`, 'utf8') : ''
ok(arq ? /^\d{12}05_/.test(arq) : false, 'segundos do timestamp = 05 (faixa gilberto-produto)')
for (const t of ['erp_infra_desenho_versao', 'erp_infra_no', 'erp_infra_ligacao', 'erp_infra_batimento']) ok(sql.includes(t), `tabela ${t}`)
ok(sql.includes('ENABLE ROW LEVEL SECURITY') && sql.includes('fn_dev_painel_pode_ver()') && sql.includes('FROM PUBLIC, anon'), 'RLS ligada, leitura só equipe PS, REVOKE anon')
ok(sql.includes('cadencia_min') && sql.includes('tolerancia_min'), 'nó com cadência e tolerância')
ok(!/\b(DELETE FROM|TRUNCATE|DROP TABLE)\b/i.test(sql), 'aditiva: sem DELETE/TRUNCATE/DROP TABLE')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
