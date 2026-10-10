// Gate (CEO 08/10 · Construtora Modelo - DEMO). Sem rede: confere a migration — só demonstração, planos a R$ 0,
// acesso copiado da demo GE, demo_por_area hub/hub_construcao apontando para a nova empresa, nada apagado.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261008180010_demo_hub_construtora_modelo.sql', 'utf8').replace(/--[^\n]*/g, '')
const ID = "'b0700000-0000-4000-a000-000000000006'"

ok(sql.includes(ID) && /is_demo,[\s\S]*true, 'auditoria'/.test(sql), 'empresa 006 nasce is_demo, ambiente auditoria')
ok(sql.includes("'Construtora Modelo - DEMO'"), 'nome "Construtora Modelo - DEMO"')
ok(/'v15_hub_t1'[\s\S]*'v15_gestao_empresarial_pro'/.test(sql) && /'active', 0,/.test(sql), 'planos Hub T1 + GE Pro a R$ 0')
ok(/FROM public\.user_companies uc\s+WHERE uc\.company_id = 'b0700000-0000-4000-a000-000000000004'/.test(sql), 'acesso copiado da demo GE')
ok(/\('hub',\s+'b0700000-0000-4000-a000-000000000006'\)/.test(sql) && /\('hub_construcao',\s+'b0700000-0000-4000-a000-000000000006'\)/.test(sql)
  && /ON CONFLICT \(area\) DO UPDATE/.test(sql), 'demo_por_area hub e hub_construcao → Construtora Modelo')
ok(!/\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bUPDATE\s+public\./i.test(sql), 'não apaga nem altera empresa real (RD-30)')

if (falhas) { console.error(`\n${falhas} falha(s) na demo Construtora Modelo`); process.exit(1) }
console.log('\nDemo Construtora Modelo: ok')
