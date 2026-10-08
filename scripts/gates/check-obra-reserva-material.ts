// Gate · FC estoque × obra, passo 2 — migration aditiva, com RLS, REVOKE anon e guarda de empresa. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const sql = readFileSync('supabase/migrations/20261008100005_obra_reserva_material.sql', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /CREATE POLICY obra_reserva_material_empresa/.test(sql), 'RLS ligada com policy por empresa')
ok(/REVOKE ALL ON public\.obra_reserva_material FROM PUBLIC, anon/.test(sql), 'REVOKE de anon na tabela')
ok(!/GRANT[^;]*\bDELETE\b/i.test(sql) && !/\bDELETE FROM\b/i.test(sql), 'sem DELETE')
ok(!/GRANT[^;]*\b(INSERT|UPDATE)\b[^;]*TO authenticated/i.test(sql) && /FOR SELECT TO authenticated/.test(sql), 'authenticated só lê: escrita só pela função guardada')
ok((sql.match(/fn__guarda_empresa/g) ?? []).length >= 3, 'reservar e cancelar guardam as empresas')
ok(!/CREATE OR REPLACE FUNCTION public\.fn_obra_criar_de_orcamento/.test(sql), 'não reescreve função existente')
ok(/perda_pct/.test(sql) && /disponivel/.test(sql) && /falta/.test(sql), 'perda e aviso de falta presentes')
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
