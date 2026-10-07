// Gate (CEO 07/10, Umuarama): DRE caixa — receita em NAO_OPER/RESULT_FIN soma (sinal invertido no grupo) e o gatilho
// enfileira também o mês do PAGAMENTO. Checagem estática da migration. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const sql = readFileSync('supabase/migrations/20261007190030_dre_caixa_sinal_nao_op_e_mes_pagamento.sql', 'utf8')

ok(/NAO_OPER'',''RESULT_FIN''\) THEN -d\.valor/.test(sql), 'mensal: receita (source receber) em NAO_OPER/RESULT_FIN entra negativa no grupo')
ok(/THEN -COALESCE\(r\.valor,0\)/.test(sql), 'diário: receber em NAO_OPER/RESULT_FIN entra negativo no grupo')
ok(/v_pg := fn_parse_data_text/.test(sql) && /v_pg_old/.test(sql), 'gatilho: enfileira mês do pagamento (novo e antigo)')
ok((sql.match(/RAISE EXCEPTION 'patch/g) ?? []).length >= 4, 'patches com asserção (falham alto se a definição viva mudou)')
ok(!/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s/i.test(sql.replace(/--.*$/gm, '')), 'sem DELETE/DROP/TRUNCATE')

if (falhas) process.exit(1)
