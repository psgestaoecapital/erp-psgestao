// Gate (Hub · empresa demo "Construtora Modelo"). Sem rede: confere a migration — só demonstração, plano da Tryo
// Gesso a R$ 0, acessos, demo_por_area('hub') e nada destrutivo.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261008180010_demo_hub_construtora_modelo.sql', 'utf8').replace(/--[^\n]*/g, '')
const ID = "'b0700000-0000-4000-a000-000000000006'"

ok(sql.includes(`VALUES (${ID}`) && /true, 'auditoria'/.test(sql), 'empresa 006 nasce is_demo, ambiente auditoria')
ok(sql.includes("'Construtora Modelo - DEMO'"), 'nome Construtora Modelo - DEMO')
ok(/'v15_hub_t1'[\s\S]*'v15_gestao_empresarial_pro'/.test(sql) && /'active', 0,/.test(sql), 'plano Hub T1 + GE Pro a R$ 0')
ok(/is_demo IS TRUE\)\s+AND NOT EXISTS/.test(sql), 'plano só liga em empresa is_demo, idempotente')
ok(sql.includes('4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb') && sql.includes('74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'), 'acesso do CEO e do robô')
ok(new RegExp(`VALUES \\('hub', ${ID}\\)\\s+ON CONFLICT \\(area\\) DO UPDATE`).test(sql), "demo_por_area('hub') = 006")
ok(!/\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bUPDATE\s+public\.(companies|tenant)/i.test(sql), 'não apaga nem altera empresa real')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nDemo Hub Construtora Modelo: ok')
