// Gate · Resultado por obra com custo alocado (FC Pisos) — migration com RLS, REVOKE anon, sem DELETE, view só ganha colunas no fim. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const sql = readFileSync('supabase/migrations/20261016170005_hub_resultado_obra_custo_alocado.sql', 'utf8')
const pg = readFileSync('src/app/dashboard/projetos/obras/resultado/page.tsx', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /CREATE POLICY projetos_obra_custo_empresa/.test(sql), 'RLS ligada com policy por empresa')
ok(/REVOKE ALL ON public\.projetos_obra_custo FROM PUBLIC, anon/.test(sql), 'REVOKE de anon na tabela')
ok(!/\bDELETE FROM\b/i.test(sql) && !/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*TO authenticated/i.test(sql), 'sem DELETE; authenticated só lê')
ok((sql.match(/fn__guarda_empresa/g) ?? []).length >= 2, 'lançar e estornar guardam a empresa')
ok(/security_invoker = true/.test(sql) && /REVOKE ALL ON public\.v_obra_resultado FROM anon, PUBLIC/.test(sql), 'view segue security_invoker sem anon')
ok(/AS custo_mao_obra[\s\S]*AS custo_compras[\s\S]*AS custo_outros\s+FROM/.test(sql), 'colunas novas só no fim da view')
for (const k of ['custo_mao_obra', 'custo_compras', 'custo_outros']) ok(pg.includes(`projetos.resultado_obra.${k}`) && sql.includes(`'projetos.resultado_obra.${k}'`), `"?" ${k} na tela e no banco`)
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
