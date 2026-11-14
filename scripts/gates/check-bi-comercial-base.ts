// Gate · Painel comercial v5 › RPC do pacote de dados __BASE__ (CEO 07/11, dev7claudeps · item 1).
// Sem rede. Confere, na migration que cria fn_bi_comercial_base, as propriedades de SEGURANÇA que
// garantem o isolamento por vendedor e o fail-closed (um vendedor nunca vê venda de outro):
//  1) genérico: nenhuma empresa fixa (UUID) no código;
//  2) função SECURITY DEFINER com search_path fixo;
//  3) exige usuário logado (RAISE sem auth.uid());
//  4) usa a MESMA guarda do BI (fn_bi_comercial_scope) e é FAIL-CLOSED (sem_acesso -> exceção);
//  5) o filtro de escopo de venda está no servidor (lider vê tudo; senão só o próprio código);
//  6) nada aberto a anônimo (REVOKE PUBLIC/anon; GRANT só authenticated);
//  7) nenhum campo de custo/margem na RPC;
//  8) ADITIVA: nada apagado e só a função nova é (re)criada.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_comercial_bi_base_v5.sql'))
if (arq.length !== 1) { console.error(`✗ esperava 1 migration *_comercial_bi_base_v5.sql, achei ${arq.length}`); process.exit(1) }
const mig = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
ok(!UUID.test(sql), 'nenhuma empresa fixa (genérico)')
ok(/CREATE OR REPLACE FUNCTION public\.fn_bi_comercial_base\(/.test(sql), 'cria fn_bi_comercial_base')
ok(/SECURITY\s+DEFINER/i.test(sql) && /SET search_path TO 'public'/.test(sql), 'SECURITY DEFINER com search_path fixo')
ok(/IF v_uid IS NULL THEN\s*RAISE EXCEPTION/i.test(sql), 'exige usuário logado')
ok(/public\.fn_bi_comercial_scope\(p_company_id\)/.test(sql), 'usa a guarda de escopo do BI')
ok(/v_modo\s*=\s*'sem_acesso'[\s\S]{0,40}RAISE EXCEPTION/i.test(sql), 'fail-closed: sem_acesso levanta exceção')
ok(/v_modo\s*=\s*'lider'\s*OR\s*i\.vendedor\s*=\s*v_cod/.test(sql), 'filtro de escopo de venda no servidor (vendedor só o próprio)')
ok(/REVOKE ALL ON FUNCTION public\.fn_bi_comercial_base\(uuid, date, date\) FROM PUBLIC, anon/.test(sql), 'nada aberto a anônimo')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_bi_comercial_base\(uuid, date, date\) TO authenticated/.test(sql), 'liberado só a usuário logado/serviço')
ok(!/->>\s*'[^']*CUSTO|\bVALOR_CUSTO\b|\bpreco_custo\b|\bcusto_unitario\b|\bmargem_\w/i.test(sql), 'nenhum campo de custo/margem na RPC')
ok(!/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b|\bUPDATE\s+\w/i.test(sql), 'nada apagado/alterado (aditiva)')
const recriadas = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g)].map((m) => m[1])
ok(recriadas.length === 1 && recriadas[0] === 'fn_bi_comercial_base', 'só a função nova é (re)criada')

if (falhas) { console.error(`\n${falhas} falha(s) — Painel comercial v5 · RPC __BASE__`); process.exit(1) }
console.log('\nPainel comercial v5 · RPC __BASE__ ok')
