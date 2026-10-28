// Gate · P&M Onda PM-F, PR F1 (CEO 28/10/2026, Documento Mestre P&M V30 §00-F): "o contrato ativo gera o FEE".
// Sem rede. Confere na migration que:
//  1) a ativação do contrato na GE (UPDATE de status para 'ativo' e INSERT já ativo) dispara a geração do fee;
//  2) a geração é idempotente (índice único parcial em agency_contratos.erp_contrato_id + busca antes de inserir);
//  3) os itens do fee vêm de agency_proposta_itens (a fonte real) e, sem proposta, nasce 1 item do objeto do contrato;
//  4) falha na geração NUNCA bloqueia a ativação (EXCEPTION WHEN OTHERS → evento 'fee_erro');
//  5) o pedido avisa todos os financeiros (sem nenhum: sócio/acesso total) e a mudança de status avisa o solicitante;
//  6) nada aberto a anônimo, nenhuma função existente recriada, nada apagado.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const mig = readFileSync('supabase/migrations/20261030130000_pm_fee_nasce_do_contrato.sql', 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

ok(/CREATE UNIQUE INDEX IF NOT EXISTS ux_agency_contratos_erp_contrato[\s\S]*?WHERE erp_contrato_id IS NOT NULL/.test(sql), '1 fee por contrato da GE (índice único parcial)')
ok(/SELECT id INTO v_fee FROM agency_contratos WHERE erp_contrato_id = c\.id/.test(sql) && /'ja_existia', true/.test(sql), 'idempotente: reabre o fee existente em vez de criar outro')
ok(/AFTER UPDATE OF status ON public\.erp_contratos[\s\S]*?WHEN \(NEW\.status = 'ativo' AND OLD\.status IS DISTINCT FROM NEW\.status\)/.test(sql), 'gatilho na passagem para ativo (qualquer caminho)')
ok(/AFTER INSERT ON public\.erp_contratos[\s\S]*?WHEN \(NEW\.status = 'ativo'\)/.test(sql), 'gatilho no contrato que já nasce ativo')
ok(/FROM agency_proposta_itens i[\s\S]*?WHERE i\.proposta_id = v_prop\.id AND i\.excluido_em IS NULL/.test(sql), 'itens do fee vêm de agency_proposta_itens (não do jsonb)')
ok(/IF v_itens = 0 THEN[\s\S]*?'Objeto do contrato'/.test(sql), 'sem itens: 1 item do objeto do contrato para o atendimento detalhar')
ok(/EXCEPTION WHEN OTHERS THEN[\s\S]*?'fee_erro'/.test(sql), 'falha no fee não bloqueia a ativação (evento fee_erro)')
ok(/'fee_gerado'/.test(sql), 'fee gerado fica no histórico do contrato')
ok(/role = 'financeiro'[\s\S]*?IF v_n_fin <> 1 THEN[\s\S]*?ARRAY\['socio','acesso_total'\]/.test(sql), 'pedido avisa todos os financeiros; sem nenhum, sócio/acesso total; 1 só já é avisado na origem')
ok(/NEW\.solicitante_id[\s\S]*?'contrato_status'/.test(sql), 'mudança de status avisa o solicitante')
ok(/v_interno OR auth\.role\(\) = 'service_role' OR c\.company_id IN \(SELECT get_user_company_ids\(\)\) OR is_admin\(\)/.test(sql), 'chamada por usuário só na própria empresa')
for (const fn of ['fn_pm_fee_gerar_do_contrato(uuid)', 'trg_erp_contrato_fee_pm()', 'trg_erp_contrato_avisos()']) {
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon`).test(sql), `nada aberto a anônimo: ${fn}`)
}
ok(!/\bTO\s+(?:anon|PUBLIC)\b/i.test(sql.replace(/FROM PUBLIC, anon/g, '')), 'nenhum GRANT a anon/PUBLIC')
ok(!/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b/i.test(sql), 'nada apagado')
const recriadas = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g)].map((m) => m[1])
ok(recriadas.every((n) => ['fn_pm_fee_gerar_do_contrato', 'trg_erp_contrato_fee_pm', 'trg_erp_contrato_avisos'].includes(n)), 'só funções novas (nenhuma existente recriada)')

if (falhas) { console.error(`\n${falhas} falha(s) — PM-F F1 (fee nasce do contrato)`); process.exit(1) }
console.log('\nPM-F F1 ok')
