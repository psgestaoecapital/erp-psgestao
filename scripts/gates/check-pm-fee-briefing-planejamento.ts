// Gate · P&M Onda PM-F, PR F2 (CEO 28/10/2026, Documento Mestre P&M V30 §00-F): Fee → Briefing → Planejamento → Jobs.
// Sem rede. Confere na migration que:
//  1) briefing e planejamento ganham o vínculo com o fee (e o planejamento com o briefing), colunas anuláveis;
//  2) o vínculo só aceita fee/briefing da mesma empresa e do mesmo cliente;
//  3) o job que nasce do item aprovado do planejamento herda o fee (contrato_id) e o briefing, sem sobrescrever;
//  4) fn_pm_planejamento_do_fee: guarda de empresa, idempotente por cliente/mês/campanha, um item por serviço
//     contratado no mês, tudo em rascunho, com teto;
//  5) nada aberto a anônimo, nenhuma função existente recriada, nada apagado.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const mig = readFileSync('supabase/migrations/20261030130100_pm_fee_briefing_planejamento.sql', 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

ok(/ALTER TABLE public\.agency_briefings\s+ADD COLUMN IF NOT EXISTS fee_id uuid REFERENCES public\.agency_contratos\(id\) ON DELETE SET NULL/.test(sql), 'briefing ganha fee_id')
ok(/ALTER TABLE public\.agency_planejamentos ADD COLUMN IF NOT EXISTS fee_id uuid REFERENCES public\.agency_contratos\(id\)/.test(sql), 'planejamento ganha fee_id')
ok(/ALTER TABLE public\.agency_planejamentos ADD COLUMN IF NOT EXISTS briefing_id uuid REFERENCES public\.agency_briefings\(id\)/.test(sql), 'planejamento ganha briefing_id')
ok(!/NOT NULL/.test(sql.match(/ALTER TABLE[^;]+;/g)?.join('\n') ?? ''), 'colunas novas anuláveis (nada existente quebra)')
ok(/f\.company_id <> NEW\.company_id[\s\S]*?Fee não encontrado nesta empresa/.test(sql), 'fee só da mesma empresa')
ok(/f\.erp_cliente_id <> NEW\.cliente_id[\s\S]*?outro cliente/.test(sql) && /f\.cliente_id <> NEW\.cliente_id/.test(sql), 'fee só do mesmo cliente (briefing e planejamento)')
ok(/b\.fee_id <> NEW\.fee_id[\s\S]*?outro fee/.test(sql), 'briefing do planejamento é do mesmo fee')
ok(/contrato_id = COALESCE\(contrato_id, p\.fee_id\)[\s\S]*?briefing_id = COALESCE\(briefing_id, p\.briefing_id\)/.test(sql), 'job herda fee e briefing sem sobrescrever')
ok(/WHEN \(OLD\.job_id IS NULL AND NEW\.job_id IS NOT NULL\)/.test(sql), 'herança dispara quando o post vira job')
ok(/PERFORM public\.fn__guarda_empresa\(f\.company_id\)/.test(sql), 'planejamento do fee confere a empresa')
ok(/'ja_existia', true/.test(sql) && /lower\(COALESCE\(campanha, ''\)\) = lower\(COALESCE\(v_campanha, ''\)\)/.test(sql), 'idempotente por cliente/mês/campanha')
ok(/'planejamento_de_outro_fee'/.test(sql), 'não sequestra planejamento de outro fee')
ok(/'rascunho', v_ordem\)/.test(sql) && /EXIT WHEN v_total >= 120/.test(sql) && /LEAST\(GREATEST\(v_n, 0\), 60\)/.test(sql), 'itens em rascunho, com teto')
for (const fn of ['fn_pm_planejamento_do_fee(uuid, date, text)', 'trg_agency_fee_vinculo_validar()', 'trg_agency_post_job_herda_fee()']) {
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon`).test(sql), `nada aberto a anônimo: ${fn}`)
}
ok(!/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b/i.test(sql), 'nada apagado')
const recriadas = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g)].map((m) => m[1])
ok(recriadas.every((n) => ['fn_pm_planejamento_do_fee', 'trg_agency_fee_vinculo_validar', 'trg_agency_post_job_herda_fee'].includes(n)), 'só funções novas (nenhuma existente recriada)')

if (falhas) { console.error(`\n${falhas} falha(s) — PM-F F2 (fee no briefing e no planejamento)`); process.exit(1) }
console.log('\nPM-F F2 ok')
