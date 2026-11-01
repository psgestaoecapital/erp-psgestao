/**
 * Gate de build (Hub · resultado por obra): a função que liga o pedido de venda à obra tem guarda de acesso nas duas
 * pontas, audita e não fica aberta ao anon. Checagem estática da migration.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261023143005_pedido_vincular_obra.sql'), 'utf8')
ok(/fn_pedido_vincular_obra\(p_pedido_id uuid, p_obra_id uuid\)/.test(sql), 'função fn_pedido_vincular_obra(pedido, obra)')
ok(/SECURITY DEFINER SET search_path/.test(sql), 'SECURITY DEFINER com search_path fixo')
ok(/v_ped\.company_id NOT IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sql), 'guarda de acesso ao pedido')
ok(/v_obra\.company_id NOT IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sql), 'guarda de acesso à obra')
ok(/INSERT INTO audit_log_global/.test(sql), 'auditoria em audit_log_global')
ok(/REVOKE ALL ON FUNCTION public\.fn_pedido_vincular_obra\(uuid, uuid\) FROM PUBLIC, anon/.test(sql), 'REVOKE de anon')
ok(!/\bDELETE\b/i.test(sql.replace(/--.*$/gm, '')), 'sem DELETE')

if (falhas) { console.error(`\n[check-pedido-vincular-obra] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-pedido-vincular-obra] vínculo pedido × obra conferido.')
