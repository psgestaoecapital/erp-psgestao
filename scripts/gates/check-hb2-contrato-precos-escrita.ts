// Gate HB2 — escrita do contrato de preços e medição ao cliente: RPCs com guarda de empresa e REVOKE anon,
// tela usa as RPCs (nunca escreve direto na tabela) e todo campo novo tem "?" com chave semeada na migration.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_hb2_contrato_precos_escrita_medicao.sql'))!
const sql = readFileSync(`supabase/migrations/${arq}`, 'utf8')
ok(/^\d{8}\d{4}35_/.test(arq), 'migration na faixa 35')
for (const fn of ['fn_tabela_preco_salvar', 'fn_tabela_preco_arquivar', 'fn_tabela_preco_medir'])
  ok(sql.includes(`FUNCTION public.${fn}(`) && new RegExp(`REVOKE ALL ON FUNCTION[^;]*${fn}[^;]*FROM PUBLIC, anon`).test(sql), `${fn} com REVOKE anon`)
ok((sql.match(/fn__guarda_empresa/g) ?? []).length >= 3, 'as 3 funções chamam fn__guarda_empresa')
const dir = 'src/app/dashboard/projetos/tabelas-preco'
const fontes = [`${dir}/page.tsx`, `${dir}/_componentes/ContratoEditor.tsx`, `${dir}/_componentes/MedicaoContrato.tsx`].map(f => readFileSync(f, 'utf8')).join('\n')
ok(!/from\('erp_tabela_preco_\w+'\)\s*\.(insert|update|delete|upsert)/.test(fontes), 'tela não escreve direto nas tabelas')
ok(['fn_tabela_preco_salvar', 'fn_tabela_preco_arquivar', 'fn_tabela_preco_medir'].every(f => fontes.includes(f)), 'tela chama as 3 RPCs')
const chaves = [...fontes.matchAll(/chave="(hub\.tabela_preco\.[a-z_]+)"/g)].map(m => m[1])
const semeadas = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const c of new Set(chaves)) ok(semeadas.includes(`'${c}'`), `chave de ajuda ${c} semeada`)
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
