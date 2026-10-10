// Gate · FC estoque × obra, passo 1 — migration aditiva, com RLS, REVOKE anon e guarda de empresa. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const sql = readFileSync('supabase/migrations/20261008000005_hub_insumo_produto_grupo.sql', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /CREATE POLICY hub_insumo_produto_empresa/.test(sql), 'RLS ligada com policy por empresa')
ok(/REVOKE ALL ON public\.hub_insumo_produto FROM PUBLIC, anon/.test(sql), 'REVOKE de anon na tabela')
ok(!/GRANT[^;]*\bDELETE\b/i.test(sql) && !/\bDELETE FROM\b/i.test(sql), 'sem DELETE')
ok(!/GRANT[^;]*\b(INSERT|UPDATE)\b[^;]*TO authenticated/i.test(sql) && /FOR SELECT TO authenticated/.test(sql), 'authenticated só lê: escrita só pela função guardada')
ok((sql.match(/fn__guarda_empresa/g) ?? []).length >= 4, 'vincular e custo guardam as duas empresas')
ok(/GREATEST\(/.test(sql) && /usar_maior_custo/.test(sql), 'opção "maior custo" presente')
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
