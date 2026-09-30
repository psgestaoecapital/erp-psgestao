// Gate (CEO 30/09 · demo GE inclui a área Hub). Roda no build, sem rede: confere a migration — só demonstração
// (guarda is_demo que ABORTA), plano Hub a R$ 0, demo_por_area('hub') = GE, decisão registrada, e a troca do briefing
// é pontual e verificada (âncora única, idempotente).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20260930170000_demo_ge_hub.sql', 'utf8')
const sql = mig.replace(/--[^\n]*/g, '')
const GE = "'b0700000-0000-4000-a000-000000000004'"

ok(sql.includes(`c constant uuid := ${GE}`), 'age só na demo Comércio (GE)')
ok(/is_demo IS TRUE\) THEN\s+RAISE EXCEPTION/.test(sql), 'sem is_demo a migration ABORTA (nunca liga plano em empresa real)')
ok(/VALUES \(c, 'v15_hub_t1', 'active', 0,/.test(sql) && /monthly_price_brl = 0/.test(sql), 'plano Hub ativo a R$ 0 (fora do MRR), idempotente')
ok(/INSERT INTO public\.demo_por_area \(area, company_id\) VALUES \('hub', c\)\s+ON CONFLICT \(area\) DO UPDATE/.test(sql), "demo_por_area('hub') = demo GE")
ok(/INSERT INTO public\.erp_contexto_projeto[\s\S]*'decisao'[\s\S]*Demo GE inclui a área Hub/.test(sql) && /IF NOT EXISTS \(SELECT 1 FROM public\.erp_contexto_projeto/.test(sql), 'decisão registrada uma vez em erp_contexto_projeto')
ok(/''demos'', \(SELECT jsonb_object_agg\(d\.area/.test(sql) && sql.includes('FROM demo_por_area d JOIN companies c'), "briefing ganha a chave 'demos' (lida de demo_por_area)")
ok(/<> 1 THEN\s+RAISE EXCEPTION/.test(sql) && /position\('''demos''' IN v_def\) > 0 THEN[\s\S]*?RETURN;/.test(sql), 'troca no briefing: âncora única verificada e idempotente')
ok(!/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i.test(sql), 'não apaga nada (RD-30)')

if (falhas) { console.error(`\n${falhas} falha(s) na demo GE com Hub`); process.exit(1) }
console.log('\nDemo GE com Hub: ok')
