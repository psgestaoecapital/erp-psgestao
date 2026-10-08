// Gate (CEO 08/10 · HB1 resultado por obra — custo). Sem rede. Confere fn_obras_custo: só leitura, guarda por
// empresa, fechada ao anon, sem dupla contagem de viagem e sem lançamento excluído.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261008160100_obras_custo_resultado.sql', 'utf8').replace(/--[^\n]*/g, '')

ok(/CREATE OR REPLACE FUNCTION public\.fn_obras_custo\(p_company_ids uuid\[\]\)/.test(sql), 'fn_obras_custo(p_company_ids uuid[])')
ok(/i\.excluido_em IS NULL/.test(sql) && /v\.excluido_em IS NULL/.test(sql), 'item/viagem excluído não conta')
ok(/p\.deleted_at IS NULL AND p\.status <> 'cancelado'/.test(sql), 'conta a pagar excluída ou cancelada não conta')
ok(/NOT EXISTS \(SELECT 1 FROM public\.erp_viagem_lancamento v WHERE v\.pagar_id = p\.id/.test(sql), 'viagem não conta em dobro (compras × viagens)')
ok(/o\.centro_custo_id IS NOT NULL/.test(sql), 'obra sem centro de custo não puxa compras')
ok(/IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sql), 'guarda: só empresas do usuário')
ok(/STABLE SECURITY DEFINER/.test(sql) && /SET search_path TO 'public'/.test(sql), 'STABLE com search_path fixo')
ok(/REVOKE ALL ON FUNCTION public\.fn_obras_custo\(uuid\[\]\) FROM PUBLIC, anon;/.test(sql), 'fechada ao anon')
ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(sql), 'não grava nada')

if (falhas) { console.error(`\n${falhas} falha(s) no custo por obra`); process.exit(1) }
console.log('\nCusto por obra: ok')
