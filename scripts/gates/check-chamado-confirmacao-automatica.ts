// Gate (CEO 16/10, msg 70a8b35f): confirmação automática de chamados — aviso em 3 dias úteis, conclusão em 5, reabrir em 30 dias. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261017080010_chamado_confirmacao_automatica.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(/fn_somar_dias_uteis\([^)]*\)[\s\S]*fn_e_feriado_nacional/.test(sql) && sql.includes('isodow'), 'dias úteis = seg–sex sem feriado nacional')
ok(/\(p_ref AT TIME ZONE 'America\/Sao_Paulo'\)::date, 3\)/.test(sql), 'aviso com 3 dias úteis sem retorno')
ok(/fn_somar_dias_uteis\(v_hoje, 2\)/.test(sql), 'conclusão 2 dias úteis depois do aviso (5 no total; backlog avisado no 1º ciclo)')
ok(sql.includes("papel = 'autor' AND m.criado_em > r.confirmacao_aviso_em") && sql.includes("'cancelar'"), 'resposta do cliente cancela a conclusão automática')
ok(sql.includes("WHERE s.status = 'aguardando_confirmacao'"), 'só chamados em aguardando_confirmacao são tocados')
ok(sql.includes('concluído automaticamente após 5 dias úteis sem retorno do cliente'), 'histórico registra a conclusão automática')
ok(sql.includes("interval '30 days'") && sql.includes("status <> 'concluida'"), 'reabrir só concluído e em até 30 dias')
ok(sql.includes("prioridade = 'alta'") && sql.includes('agente = NULL'), 'reaberto volta ao Code da carteira com prioridade')
ok(sql.includes('REVOKE ALL ON FUNCTION public.fn_chamado_confirmacao_automatica() FROM PUBLIC, anon, authenticated;'), 'rotina não é chamável pelo cliente')
ok(!/DELETE\s+FROM/i.test(sql), 'nada é apagado')

if (falhas) { console.error(`\ncheck-chamado-confirmacao-automatica: ${falhas} falha(s)`); process.exit(1) }
console.log('\nChamados · confirmação automática: ok')
