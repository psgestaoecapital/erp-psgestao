// Gate HB2 — escrita do contrato de preços: RPCs com guarda de empresa, sem anon, "?" (RD-95) nas chaves novas e usadas na tela.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_hb2_contrato_precos_escrita.sql'))!
const sql = readFileSync(`supabase/migrations/${arq}`, 'utf8')
const tela = readFileSync('src/app/dashboard/projetos/tabelas-preco/page.tsx', 'utf8')
ok(/^\d{8}\d{4}35_/.test(arq), 'migration na faixa 35')
const fns = ['fn_tabela_preco_salvar', 'fn_tabela_preco_faixa_salvar', 'fn_tabela_preco_faixa_excluir', 'fn_tabela_preco_condicao_salvar', 'fn_tabela_preco_codigo_salvar']
for (const f of fns) {
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon`).test(sql), `${f}: sem anon`)
  ok(tela.includes(`'${f}'`), `${f}: usada na tela`)
}
ok((sql.match(/fn__guarda_empresa/g) ?? []).length >= 5, 'toda RPC chama fn__guarda_empresa')
ok(/Esta faixa se sobrepõe/.test(sql), 'faixas do mesmo serviço não se sobrepõem')
const chaves = [...sql.matchAll(/\('(hub\.tabela_preco\.[a-z_]+)'/g)].map(m => m[1])
ok(chaves.length >= 7, 'chaves de ajuda novas na migration')
for (const c of chaves) ok(tela.includes(`chave="${c}"`), `"?" ${c} na tela`)
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
