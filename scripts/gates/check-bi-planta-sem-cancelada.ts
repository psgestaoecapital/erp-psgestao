// Gate · BI da Planta — compra de gado sem nota cancelada (SPEC CEO 27/11, PARTE C). Sem rede. Confere na
// migration *_bi_planta_sem_nota_cancelada.sql:
//  1) o tradutor fn_ind_compra_gado exclui STATUS 'C' (nota cancelada no ATAK);
//  2) guarda de empresa no tradutor SECURITY DEFINER; tradutor segue fora do alcance da tela (REVOKE);
//  3) não toca a coleta (atak_conexao_config, erp_credencial, erp_sync_log) nem apaga nada.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_bi_planta_sem_nota_cancelada.sql'))
if (arq.length !== 1) { console.error(`✗ esperava 1 migration *_bi_planta_sem_nota_cancelada.sql, achei ${arq.length}`); process.exit(1) }
const sql = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

ok(/CREATE OR REPLACE FUNCTION public\.fn_ind_compra_gado\(p_company_id uuid, p_de date, p_ate date\)/.test(sql), 'recria o tradutor fn_ind_compra_gado (mesma assinatura)')
ok(/AND coalesce\(f\.raw->>'STATUS', ''\) <> 'C'/.test(sql), 'nota cancelada (STATUS C) fora da conta')
ok(/SECURITY DEFINER/.test(sql) && /p_company_id IN \(SELECT public\.get_user_company_ids\(\)\) OR public\.is_admin\(\)/.test(sql), 'guarda de empresa no tradutor')
ok(/REVOKE ALL ON FUNCTION public\.fn_ind_compra_gado\(uuid, date, date\) FROM PUBLIC, anon, authenticated/.test(sql), 'tradutor fora do alcance da tela')
ok(!/atak_conexao_config|erp_credencial|erp_sync_log/.test(sql), 'coleta intacta (não toca conexão, credencial nem log de sync)')
ok(!/\bDELETE\s+FROM\b|\bUPDATE\s+public\.|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b/i.test(sql), 'nada apagado nem alterado em dado')

if (falhas) { console.error(`\n${falhas} falha(s) — BI da Planta sem nota cancelada`); process.exit(1) }
console.log('\nBI da Planta sem nota cancelada ok')
