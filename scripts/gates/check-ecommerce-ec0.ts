// Gate (CEO 08/10 · EC0 E-commerce). Sem rede: confere migration (área, módulos, Loja Modelo demo, "?" dos indicadores) e a página.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261008200010_ecommerce_ec0_esqueleto.sql', 'utf8').replace(/--[^\n]*/g, '')
const pagina = readFileSync('src/app/dashboard/ecommerce/page.tsx', 'utf8')
const ID = "'b0700000-0000-4000-a000-000000000007'"

ok(sql.includes(ID) && /is_demo,[\s\S]*true, 'auditoria'/.test(sql) && sql.includes("'Loja Modelo - DEMO'"), 'empresa 007 "Loja Modelo - DEMO" nasce is_demo')
ok(/'v15_ecommerce'[\s\S]*'v15_gestao_empresarial_pro'/.test(sql) && /'active', 0,/.test(sql), 'planos E-commerce + GE Pro a R$ 0')
ok(/\('ecommerce', 'b0700000-0000-4000-a000-000000000007'\)/.test(sql) && /ON CONFLICT \(area\) DO UPDATE/.test(sql), 'demo_por_area ecommerce → Loja Modelo')
ok(/INSERT INTO public\.area_menu_config[\s\S]*'ecommerce','ecommerce'/.test(sql) && sql.includes("'ecommerce']::text[]"), 'área e grupo ecommerce')
ok(/'ecommerce_inicio'/.test(sql) && (sql.match(/\/dashboard\/em-construcao\/ecommerce_/g) ?? []).length >= 5, 'telas futuras apontam para o placeholder (sem rota quebrada)')
ok(!/\bDELETE\b|\bTRUNCATE\b|\bUPDATE\s+public\./i.test(sql), 'não apaga nem altera dado existente')
const chaves = [...sql.matchAll(/\('(ecommerce\.inicio\.[a-z_]+)'/g)].map(m => m[1])
ok(chaves.length === 5 && chaves.every(c => pagina.includes(`'${c}'`)), 'os 5 indicadores da página têm "?" com texto no banco (RD-95)')
ok(readFileSync('src/app/dashboard/ecommerce/layout.tsx', 'utf8').includes('GuardaPlanoArea'), 'layout com guarda de plano')

if (falhas) { console.error(`\n${falhas} falha(s) no EC0`); process.exit(1) }
console.log('\nE-commerce EC0: ok')
