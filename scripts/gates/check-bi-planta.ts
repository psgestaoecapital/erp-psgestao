// Gate · Indústria › BI da Planta — Entrada do gado e abate (CEO 29/10/2026). Sem rede. Confere:
//  1) genérico: nenhuma empresa fixa na migration nem na tela; a tela lê só a fn_bi_planta_abate;
//  2) os tradutores (abate, compra, horas por setor) não são chamáveis pela tela (REVOKE de authenticated);
//  3) a porta exige usuário logado + empresa do usuário e restringe à direção (preço do gado);
//  4) onda 0: a chave natural troca só onde ainda era HASH_ROW (não sobrescreve chave já definida) e a desossa fica fora;
//  5) o tradutor do abate fica com a versão mais recente de cada animal (DISTINCT ON … imported_at DESC);
//  6) ponto sem nomes (só setor, pessoas e horas); "?" (RD-95) com as chaves cadastradas; nada apagado.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_bi_planta_entrada_abate.sql'))
if (arq.length !== 1) { console.error(`✗ esperava 1 migration *_bi_planta_entrada_abate.sql, achei ${arq.length}`); process.exit(1) }
const mig = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const tela = readFileSync('src/app/dashboard/industrial/bi-planta/page.tsx', 'utf8')

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
ok(!UUID.test(sql) && !UUID.test(tela), 'nenhuma empresa fixa (genérico)')
ok(/rpc\('fn_bi_planta_abate'/.test(tela) && !/\.from\(/.test(tela) && (tela.match(/\.rpc\(/g) || []).length === 1, 'tela lê só a fn_bi_planta_abate')
for (const f of ['fn_ind_abate_animal', 'fn_ind_compra_gado', 'fn_ind_horas_setor']) {
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\(uuid, date, date\\) FROM PUBLIC, anon, authenticated`).test(sql), `tradutor fora do alcance da tela: ${f}`)
}
ok(/IF v_uid IS NULL THEN RAISE EXCEPTION/.test(sql), 'exige usuário logado')
ok(/p_company_id IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sql), 'exige empresa do usuário')
ok(/'sem_acesso_planta'/.test(sql) && /v_role IN \('owner','socio','acesso_total','adm','admin','diretor','diretor_area','gerente'\)/.test(sql), 'restrito à direção')
ok(/REVOKE ALL ON FUNCTION public\.fn_bi_planta_abate\(uuid, text, text, date, date\) FROM PUBLIC, anon/.test(sql), 'porta fechada para anônimo')
const updates = [...sql.matchAll(/UPDATE public\.atak_fonte_mapa[\s\S]*?;/g)].map((m) => m[0])
ok(updates.length === 2 && updates.every((u) => /upper\(trim\(chave_fato_sql\)\) = 'HASH_ROW'/.test(u)), 'onda 0: chave natural só onde ainda era HASH_ROW')
ok(!/desossa_rendimento/.test(sql), 'onda 0: desossa fora (grão não é único)')
ok(/DISTINCT ON \(f\.raw->>'COD_DOCTO'[\s\S]*?f\.imported_at DESC/.test(sql), 'abate: versão mais recente de cada animal')
ok(/fn_ind_horas_setor[\s\S]*?RETURNS TABLE \(setor text, pessoas bigint, horas numeric\)/.test(sql) && !/\bnome\b/i.test(sql.slice(sql.indexOf('fn_ind_horas_setor'), sql.indexOf('fn_ind_horas_setor') + 600)), 'ponto sem nomes (LGPD)')
ok(!/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b/i.test(sql), 'nada apagado')
const chaves = [...tela.matchAll(/AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
const dinamicas = [...tela.matchAll(/kpi\('[^']+', '([^']+)'/g)].map((m) => m[1])
const todas = new Set([...chaves, ...dinamicas, ...[...tela.matchAll(/ajuda="([^"]+)"/g)].map((m) => m[1])])
ok(todas.size > 0, '"?" na tela')
for (const k of todas) ok(mig.includes(`('${k}',`), `chave de ajuda cadastrada: ${k}`)
ok(/module_catalog[\s\S]*'\/dashboard\/industrial\/bi-planta'/.test(sql) && /system_screens[\s\S]*'\/dashboard\/industrial\/bi-planta'/.test(sql), 'tela no menu e em system_screens')

if (falhas) { console.error(`\n${falhas} falha(s) — BI da Planta`); process.exit(1) }
console.log('\nBI da Planta ok')
