// Gate · GE › Resultado por negócio (CEO 06/11/2026). Sem rede. Confere:
//  1) ADITIVO: a migration não reescreve o DRE oficial (fn_psgc_recalcular_dre_mes, psgc_dre, motor de rateio) nem
//     altera/apaga lançamento (erp_pagar / erp_receber só são LIDOS);
//  2) genérico: nenhuma empresa fixa na migration nem nas telas;
//  3) o cálculo interno não é chamável pela tela; a porta exige login + empresa do usuário;
//  4) ordem das regras: linha da receita (1) > centro (2) > texto (3) > conta (4), conta mais específica ganha;
//  5) investimento e distribuição ficam fora do resultado; receita sem negócio não é rateada;
//  6) a tela lê só a porta; "?" (RD-95) com chave cadastrada; tela no menu e em system_screens.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_ge_resultado_por_negocio.sql'))
if (arq.length !== 1) { console.error(`✗ esperava 1 migration *_ge_resultado_por_negocio.sql, achei ${arq.length}`); process.exit(1) }
const mig = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const tela = readFileSync('src/app/dashboard/gestao-empresarial/resultado-por-negocio/page.tsx', 'utf8')
const regras = readFileSync('src/app/dashboard/gestao-empresarial/centros-custo/RegrasRateio.tsx', 'utf8')

ok(!/fn_psgc_recalcular_dre_mes|fn_rateio_calcular_mes|INSERT INTO public\.psgc_dre|UPDATE public\.psgc_dre/.test(sql), 'não mexe no DRE oficial nem no motor de rateio')
ok(!/(UPDATE|DELETE FROM|INSERT INTO)\s+public\.erp_(pagar|receber)\b/i.test(sql), 'lançamentos só lidos')
ok(!/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+(TABLE|FUNCTION|COLUMN)\b/i.test(sql), 'nada apagado')
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
ok(!UUID.test(sql) && !UUID.test(tela) && !UUID.test(regras), 'nenhuma empresa fixa (genérico)')
ok(/REVOKE ALL ON FUNCTION public\.fn_ge_resultado_por_negocio_calc\(uuid, date, date, text\) FROM PUBLIC, anon, authenticated/.test(sql), 'cálculo interno fora do alcance da tela')
ok(/IF v_uid IS NULL THEN RAISE EXCEPTION/.test(sql) && /p_company_id IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sql), 'porta exige login e empresa do usuário')
ok(/REVOKE ALL ON FUNCTION public\.fn_ge_resultado_por_negocio\(uuid, date, date, text\) FROM PUBLIC, anon/.test(sql), 'porta fechada para anônimo')
ok(/'linha do lançamento'::text AS via/.test(sql) && /, 2, 0, 'centro '/.test(sql) && /, 3, length\(g\.chave\), 'texto/.test(sql) && /, 4, length\(g\.chave\), 'conta '/.test(sql), 'ordem das regras: linha > centro > texto > conta')
ok(/ORDER BY origem, id, nivel, len DESC/.test(sql), 'conta mais específica ganha')
ok(/WHEN epc\.tipo = 'investimento' THEN 'INVESTIMENTO'/.test(sql) && /linha NOT IN \('investimento','destinacao','neutro'\)/.test(sql), 'investimento e distribuição fora do resultado')
ok(/bl_id IS NULL AND origem = 'pagar'/.test(sql), 'só despesa sem negócio entra no rateio (receita sem negócio não)')
ok(/'conta','texto'\]::text\[\]/.test(sql) && /'centro_custo'/.test(sql), 'tipos novos de regra sem tirar os antigos')
ok(/rpc\('fn_ge_resultado_por_negocio'/.test(tela) && !/\.from\(/.test(tela), 'tela lê só a porta')
const chaves = new Set([...tela, ...regras].length ? [
  ...[...tela.matchAll(/(?:AjudaCampo chave|ajuda)="([^"]+)"/g)].map((m) => m[1]),
  ...[...regras.matchAll(/AjudaCampo chave="([^"]+)"/g)].map((m) => m[1]),
] : [])
ok(chaves.size >= 10, '"?" nas telas')
for (const k of chaves) ok(mig.includes(`('${k}',`), `chave de ajuda cadastrada: ${k}`)
ok(/module_catalog[\s\S]*'\/dashboard\/gestao-empresarial\/resultado-por-negocio'/.test(sql) && /system_screens[\s\S]*'\/dashboard\/gestao-empresarial\/resultado-por-negocio'/.test(sql), 'tela no menu e em system_screens')

if (falhas) { console.error(`\n${falhas} falha(s) — Resultado por negócio`); process.exit(1) }
console.log('\nResultado por negócio ok')
