// Gate HB2 fatia 2 — fn_tabela_preco_calcular: migration aditiva, invoker (RLS vale), sem anon, só leitura.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_hb2_fn_tabela_preco_calcular.sql'))!
const sql = readFileSync(`supabase/migrations/${arq}`, 'utf8')
ok(/^\d{8}\d{4}05_/.test(arq), 'migration na faixa 05 (gilberto-produto)')
ok(/SECURITY INVOKER/.test(sql) && !/SECURITY DEFINER/.test(sql), 'invoker: a RLS por empresa das tabelas vale')
ok(/REVOKE ALL ON FUNCTION public\.fn_tabela_preco_calcular\(uuid,text,numeric,text\) FROM anon/.test(sql), 'sem anon')
ok(!/\b(INSERT|UPDATE|DELETE)\b\s+(INTO|FROM)?\s*(public\.)?erp_/i.test(sql.replace(/SELECT[^;]*?FROM/gis, '')), 'somente leitura')
ok(/NOT i\.adicional/.test(sql) && /faixa_ate IS NULL OR p_quantidade < i\.faixa_ate/.test(sql), 'faixa [de, ate) como no TS')
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
