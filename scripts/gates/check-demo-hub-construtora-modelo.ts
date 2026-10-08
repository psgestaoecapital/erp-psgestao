// Gate (CEO 08/10 · empresa demo do Hub "Construtora Modelo - DEMO"). Sem rede: confere a migration —
// id fixo, is_demo, plano igual ao da Tryo a R$ 0, demo_por_area hub/hub_construcao, aditiva (sem apagar nada).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261008180010_hub_demo_empresa_construtora_modelo.sql', 'utf8').replace(/--[^\n]*/g, '')
const ID = "'b0700000-0000-4000-a000-000000000006'"

ok(sql.includes(ID) && sql.includes("'Construtora Modelo - DEMO'"), 'empresa com id fixo e nome combinado')
ok(/is_demo, ambiente_tenant[\s\S]*true, 'auditoria'/.test(sql), 'is_demo = true, ambiente auditoria')
ok(sql.includes("'v15_hub_t1'") && sql.includes("'v15_gestao_empresarial_pro'") && /'active', 0/.test(sql), 'plano da Tryo (Hub + Gestão Empresarial) a R$ 0')
ok(/'hub', 'b0700000-0000-4000-a000-000000000006'/.test(sql) && /'hub_construcao', 'b0700000-0000-4000-a000-000000000006'/.test(sql), 'demo_por_area hub e hub_construcao apontam para ela')
ok(!/\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bUPDATE\b/i.test(sql.replace(/ON CONFLICT[^;]*DO UPDATE SET[^;]*/g, '')), 'aditiva: não apaga nem altera dado')

if (falhas) { console.error(`\n${falhas} falha(s) na demo Construtora Modelo`); process.exit(1) }
console.log('\nDemo Construtora Modelo: ok')
