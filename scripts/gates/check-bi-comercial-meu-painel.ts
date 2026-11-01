// Gate · Comercial › Meu painel de vendas (CEO 29/10/2026). Sem rede. Confere:
//  1) genérico: nenhuma empresa fixa no código nem na migration; a tela só lê fn_bi_comercial_painel;
//  2) os tradutores (fn_com_venda_item / fn_com_equipe) não são chamáveis pela tela (REVOKE de authenticated);
//  3) a porta exige usuário logado + empresa do usuário, e quem tem vínculo fica preso à própria subárvore
//     (p_no fora do permitido volta para a raiz do vínculo);
//  4) o vínculo só é gravado por quem administra a empresa; tabela com RLS e sem escrita direta;
//  5) "?" (RD-95) nas telas com as chaves cadastradas; nada apagado; nenhuma função existente recriada.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_comercial_bi_meu_painel.sql'))
if (arq.length !== 1) { console.error(`✗ esperava 1 migration *_comercial_bi_meu_painel.sql, achei ${arq.length}`); process.exit(1) }
const mig = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
// Painel completo (CEO 29/10, "ficou pobre"): recria a MESMA fn_bi_comercial_painel com mais blocos — a guarda
// tem de continuar idêntica na versão viva (a última migration que a define).
const arqC = readdirSync('supabase/migrations').filter((f) => f.endsWith('_comercial_bi_painel_completo.sql'))
const migC = arqC.length ? readFileSync(`supabase/migrations/${arqC[0]}`, 'utf8') : ''
const sqlC = migC.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const tela = readFileSync('src/app/dashboard/comercial/meu-painel/page.tsx', 'utf8')
const adm = readFileSync('src/app/dashboard/admin/vendedores/page.tsx', 'utf8')

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
ok(!UUID.test(sql) && !UUID.test(tela) && !UUID.test(adm), 'nenhuma empresa fixa (genérico)')
ok(/rpc\('fn_bi_comercial_painel'/.test(tela) && !/\.from\(/.test(tela), 'tela lê só a fn_bi_comercial_painel')
ok(/REVOKE ALL ON FUNCTION public\.fn_com_venda_item\(uuid, date, date\) FROM PUBLIC, anon, authenticated/.test(sql), 'tradutor de venda fora do alcance da tela')
ok(/REVOKE ALL ON FUNCTION public\.fn_com_equipe\(uuid\) FROM PUBLIC, anon, authenticated/.test(sql), 'tradutor de equipe fora do alcance da tela')
ok(/IF v_uid IS NULL THEN RAISE EXCEPTION/.test(sql), 'exige usuário logado')
ok(/p_company_id IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sql), 'exige empresa do usuário')
ok(/IF v_vinculo IS NOT NULL THEN\s+v_raiz := v_vinculo;/.test(sql), 'quem tem vínculo fica preso à própria subárvore')
ok(/CASE WHEN p_no IS NOT NULL AND p_no IN \(SELECT no FROM perm\) THEN p_no ELSE v_raiz END/.test(sql), 'visão pedida fora do permitido volta para a raiz')
ok(/'sem_vinculo_vendedor'/.test(sql), 'sem vínculo e sem cargo de direção: não vê nada')
ok(/IF NOT public\.fn_com_vendedor_acesso_pode\(p_company_id\) THEN RAISE EXCEPTION/.test(sql) && (sql.match(/fn_com_vendedor_acesso_pode\(p_company_id\) THEN RAISE/g) || []).length >= 2, 'listar e salvar vínculo só para quem administra')
ok(/ALTER TABLE public\.com_vendedor_acesso ENABLE ROW LEVEL SECURITY/.test(sql) && /REVOKE INSERT, UPDATE, DELETE ON public\.com_vendedor_acesso FROM authenticated/.test(sql), 'tabela de vínculo com RLS e sem escrita direta')
for (const f of ['fn_bi_comercial_painel(uuid, text, date, date)', 'fn_com_vendedor_acesso_listar(uuid)', 'fn_com_vendedor_acesso_salvar(uuid, text, uuid)', 'fn_com_vendedor_acesso_pode(uuid)']) {
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon`).test(sql), `nada aberto a anônimo: ${f}`)
}
ok(!/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b/i.test(sql), 'nada apagado')
if (sqlC) {
  ok(!UUID.test(sqlC), 'painel completo: nenhuma empresa fixa')
  ok(/IF v_uid IS NULL THEN RAISE EXCEPTION/.test(sqlC) && /p_company_id IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sqlC), 'painel completo: mesma exigência de usuário e empresa')
  ok(/IF v_vinculo IS NOT NULL THEN\s+v_raiz := v_vinculo;/.test(sqlC) && /CASE WHEN p_no IS NOT NULL AND p_no IN \(SELECT no FROM perm\) THEN p_no ELSE v_raiz END/.test(sqlC) && /'sem_vinculo_vendedor'/.test(sqlC), 'painel completo: mesma trava de vínculo')
  ok(/REVOKE ALL ON FUNCTION public\.fn_bi_comercial_painel\(uuid, text, date, date\) FROM PUBLIC, anon/.test(sqlC), 'painel completo: nada aberto a anônimo')
  ok(!/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b/i.test(sqlC), 'painel completo: nada apagado')
  ok([...sqlC.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g)].every((m) => m[1] === 'fn_bi_comercial_painel'), 'painel completo: só recria a própria porta do painel')
}
const novas = ['fn_com_venda_item', 'fn_com_equipe', 'fn_bi_comercial_painel', 'fn_com_vendedor_acesso_pode', 'fn_com_vendedor_acesso_listar', 'fn_com_vendedor_acesso_salvar']
const recriadas = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g)].map((m) => m[1])
ok(recriadas.every((n) => novas.includes(n)), 'só funções novas')
for (const [nome, txt] of [['meu-painel', tela], ['vendedores', adm]] as const) {
  const chaves = [...txt.matchAll(/AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
  ok(chaves.length > 0, `"?" na tela ${nome}`)
  for (const k of new Set(chaves)) ok(mig.includes(`('${k}',`) || migC.includes(`('${k}',`), `chave de ajuda cadastrada: ${k}`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — Meu painel de vendas`); process.exit(1) }
console.log('\nMeu painel de vendas ok')
