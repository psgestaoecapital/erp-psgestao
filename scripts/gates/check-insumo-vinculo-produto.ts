// Gate (CEO 06/10 · Virada FC 01/11, integração estoque × obra, passo a.1): o insumo do Hub passa a poder apontar para o
// produto do estoque do grupo, com custo vivo (médio ou "maior custo"). Só checagem estática da migration. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261008090005_insumo_vinculo_produto_estoque.sql', 'utf8').replace(/--[^\n]*/g, '')

ok(/ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES public\.erp_produtos\(id\) ON DELETE SET NULL/.test(mig), 'produto_id nullable, FK para erp_produtos')
ok(/custo_modo text NOT NULL DEFAULT 'medio'\s+CHECK \(custo_modo IN \('medio','maior'\)\)/.test(mig), "custo_modo: 'medio' (padrão) ou 'maior'")
ok(/CREATE OR REPLACE FUNCTION public\.fn_insumo_custo_vivo\(p_insumo_id uuid\)/.test(mig), 'função de custo vivo')
ok(/SECURITY INVOKER/.test(mig) && !/SECURITY DEFINER/.test(mig), 'SECURITY INVOKER (RLS vigente)')
ok(/GREATEST\(COALESCE\(p\.preco_custo_medio, 0\), COALESCE\(p\.preco_custo, 0\)\)/.test(mig), "modo 'maior': maior entre médio e última compra")
ok(/WHEN i\.produto_id IS NULL THEN COALESCE\(i\.current_cost, 0\)/.test(mig), 'sem vínculo, cai no current_cost')
ok(/REVOKE ALL ON FUNCTION public\.fn_insumo_custo_vivo\(uuid\) FROM PUBLIC, anon;/.test(mig), 'fechado a anon')
ok(!/\b(UPDATE|DELETE FROM|TRUNCATE|DROP)\b/.test(mig), 'aditiva: sem UPDATE/DELETE/DROP em dado de cliente')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-insumo-vinculo-produto: OK')
