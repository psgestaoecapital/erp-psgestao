/**
 * Gate de build (Hub · custos fixos por obra): o rateio automático por m² nasce desligado, tem guarda de acesso,
 * audita, não fica aberto ao anon e nunca apaga linha. Checagem estática da migration.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261020130005_obra_rateio_m2_automatico.sql'), 'utf8')
ok(/fn_obra_rateio_m2_aplicar\(p_company_id uuid, p_competencia date, p_valor_total numeric\)/.test(sql), 'função fn_obra_rateio_m2_aplicar')
ok(/SECURITY DEFINER SET search_path/.test(sql), 'SECURITY DEFINER com search_path fixo')
ok(/rateio_obra_m2_ativo boolean NOT NULL DEFAULT false/.test(sql), 'chave por empresa desligada por padrão')
ok(/p_company_id NOT IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sql), 'guarda de acesso à empresa')
ok(/INSERT INTO audit_log_global/.test(sql), 'auditoria em audit_log_global')
ok(/REVOKE ALL ON FUNCTION public\.fn_obra_rateio_m2_aplicar\(uuid, date, numeric\) FROM PUBLIC, anon/.test(sql), 'REVOKE de anon')
ok(/ROUND\(p_valor_total - v_soma, 2\)/.test(sql), 'o arredondamento fecha no total')
ok(!/\bDELETE\b/i.test(sql.replace(/--.*$/gm, '')), 'sem DELETE (troca por excluido_em)')

if (falhas) { console.error(`\n[check-obra-rateio-m2] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-obra-rateio-m2] rateio por m² conferido.')
