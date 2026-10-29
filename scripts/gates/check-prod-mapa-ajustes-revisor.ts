// Gate (revisor #3404/#3405) — modelos globais sem USING(true), planta/setor da mesma empresa e tela do Mapa no menu.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ARQ = readdirSync('supabase/migrations').find((f) => f.endsWith('_prod_mapa_ajustes_revisor_menu.sql'))
if (!ARQ) { console.error('✗ migration *_prod_mapa_ajustes_revisor_menu.sql não encontrada'); process.exit(1) }
const SQL = readFileSync(`supabase/migrations/${ARQ}`, 'utf8')
const tem = (re: RegExp) => re.test(SQL)

ok(tem(/DROP POLICY IF EXISTS prod_modelo_fluxo_ler/) && tem(/DROP POLICY IF EXISTS prod_modelo_etapa_ler/), 'policies USING(true) dos modelos removidas')
ok(tem(/REVOKE ALL ON public\.prod_modelo_fluxo FROM anon, authenticated/) && tem(/REVOKE ALL ON public\.prod_modelo_etapa FROM anon, authenticated/), 'modelos sem GRANT SELECT (só RPC)')
ok(!tem(/USING\s*\(\s*true\s*\)/i), 'nenhuma policy permissiva')
ok((SQL.match(/planta_de_outra_empresa/g) ?? []).length >= 2, 'planta da empresa conferida em fluxo_salvar e modelo_aplicar')
ok((SQL.match(/setor_de_outra_empresa/g) ?? []).length >= 2, 'setor da empresa conferido em fluxo_salvar e modelo_aplicar')
ok(tem(/LEFT JOIN prod_setor s ON s\.id = f\.setor_id AND s\.company_id = f\.company_id/), 'mapa_completo: JOIN de setor filtra empresa')
ok(tem(/'produtividade_mapa'[^)]*'\/dashboard\/produtividade\/mapa'/) && tem(/INSERT INTO public\.plan_modules/) && tem(/INSERT INTO public\.system_screens/), 'Mapa em module_catalog + plan_modules + system_screens')
const defs = SQL.match(/CREATE OR REPLACE FUNCTION public\.fn_prod_\w+/g) ?? []
const rv = SQL.match(/REVOKE ALL ON FUNCTION public\.fn_prod_\w+\([^)]*\) FROM PUBLIC, anon/g) ?? []
ok(defs.length === rv.length && defs.length === 3, `toda função tem REVOKE anon (${rv.length}/${defs.length})`)
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
