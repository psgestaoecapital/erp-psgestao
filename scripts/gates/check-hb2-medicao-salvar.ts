// Gate HB2 — medição ao cliente SALVA: funções com guarda de empresa e REVOKE anon, tabelas só com leitura direta,
// recálculo no servidor (fn_tabela_preco_medir), tela usa as RPCs e toda chave de ajuda nova está semeada.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_hb2_medicao_cliente_salvar.sql'))!
const sql = readFileSync(`supabase/migrations/${arq}`, 'utf8')
ok(/^\d{12}54_/.test(arq), 'migration na faixa 54')
for (const fn of ['fn_medicao_cliente_salvar', 'fn_medicao_cliente_excluir'])
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`).test(sql), `${fn} com REVOKE anon`)
ok((sql.match(/fn__guarda_empresa/g) ?? []).length >= 2, 'as 2 funções chamam fn__guarda_empresa')
ok(sql.includes('fn_tabela_preco_medir(p_tabela'), 'salvar recalcula no servidor pela regra do contrato')
ok(/REVOKE INSERT, UPDATE, DELETE ON public\.%I FROM authenticated/.test(sql) && sql.includes('ENABLE ROW LEVEL SECURITY'), 'tabelas com RLS e sem escrita direta')
const src = readFileSync('src/app/dashboard/projetos/tabelas-preco/_componentes/MedicaoContrato.tsx', 'utf8')
ok(!/from\('erp_medicao_cliente\w*'\)\s*\.(insert|update|delete|upsert)/.test(src), 'tela não escreve direto nas tabelas')
ok(src.includes('fn_medicao_cliente_salvar') && src.includes('fn_medicao_cliente_excluir'), 'tela chama as 2 RPCs')
for (const m of src.matchAll(/chave="(hub\.tabela_preco\.[a-z_]+)"/g)) ok(sql.includes(`'${m[1]}'`) || readdirSync('supabase/migrations').some(f => readFileSync(`supabase/migrations/${f}`, 'utf8').includes(`'${m[1]}'`)), `chave ${m[1]} semeada`)
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
