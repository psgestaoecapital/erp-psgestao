// Gate (HB3 fatia 1 · cronograma da obra). Sem rede. Confere RLS por empresa, REVOKE anon, guarda nas funções,
// exclusão lógica e bloqueio de dependência circular.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261020170030_hb3_cronograma_obra_base.sql', 'utf8').replace(/--[^\n]*/g, '')

ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && (sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length === 2, 'RLS ligada nas 2 tabelas')
ok(/REVOKE ALL ON public\.projetos_obra_tarefa, public\.projetos_obra_tarefa_dependencia FROM PUBLIC, anon;/.test(sql), 'tabelas fechadas ao anon')
ok((sql.match(/IN \(SELECT public\.get_user_company_ids\(\)\)/g) ?? []).length === 2, 'policies por empresa')
ok(!/GRANT (INSERT|UPDATE|DELETE)/i.test(sql), 'gravação só pelas funções')
ok((sql.match(/PERFORM public\.fn__guarda_empresa\(/g) ?? []).length === 4, 'as 4 funções têm guarda de empresa')
ok((sql.match(/REVOKE ALL ON FUNCTION/g) ?? []).length === 4, 'as 4 funções fechadas ao anon')
ok(!/DELETE FROM/i.test(sql), 'exclusão lógica (sem DELETE)')
ok(/Dependência circular/.test(sql) && /WITH RECURSIVE cadeia/.test(sql), 'dependência circular recusada')
ok(!/CREATE OR REPLACE VIEW|ALTER TABLE public\.projetos_obras/.test(sql), 'só objetos novos')

if (falhas) { console.error(`\n${falhas} falha(s) no cronograma da obra`); process.exit(1) }
console.log('\nCronograma da obra (base): ok')
