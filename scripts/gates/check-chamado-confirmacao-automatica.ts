// Gate (CEO 16/10, RD-97): confirmação automática de chamados — aviso 3 du, conclusão 5 du, resposta cancela, reabrir 30 dias.
// Estático, sem rede. Os prazos em si são provados pelo spec @pos-migration (e2e/jornadas/aceitacao/chamado-confirmacao-automatica.spec.ts).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261017230010_chamados_confirmacao_automatica.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(/fn_sugestao_somar_dias_uteis[\s\S]*fn_e_feriado_nacional\(d\)/.test(sql), 'dias úteis = seg-sex sem feriado nacional')
ok(/somar_dias_uteis\(p_base, 3\)/.test(sql) && /somar_dias_uteis\(p_aviso, 2\)/.test(sql), 'aviso aos 3 du; conclusão 2 du depois do aviso (= 5 du; backlog igual)')
ok(/WHEN COALESCE\(p_cliente_respondeu, false\) THEN CASE WHEN p_aviso IS NOT NULL THEN 'cancelar'/.test(sql), 'resposta do cliente cancela')
ok(/m\.papel = 'autor' AND m\.criado_em > COALESCE\(r\.base_em/.test(sql), 'resposta do cliente é medida pela mensagem do autor depois da base')
ok(/redigido_por IS DISTINCT FROM 'sistema-autoconfirmacao'/.test(sql), 'a mensagem automática do sistema não reinicia o relógio')
ok(/WHERE s\.status = 'aguardando_confirmacao'/.test(sql) && /AND status = 'aguardando_confirmacao';/.test(sql), 'só mexe em chamado aguardando_confirmacao')
ok(/concluído automaticamente após 5 dias úteis sem retorno do cliente/.test(sql), 'histórico registra a conclusão automática')
ok(/interval '30 days'/.test(sql) && /prazo_de_30_dias_vencido/.test(sql), 'reabertura limitada a 30 dias')
ok(/prioridade = CASE WHEN prioridade IN \('critica'\) THEN prioridade ELSE 'alta' END/.test(sql) && /atendente_id = NULL, agente = NULL/.test(sql), 'reaberto volta à fila do Code responsável com prioridade alta')
ok(/REVOKE ALL ON FUNCTION public\.fn_sugestao_autoconfirmar\(date\) FROM PUBLIC, anon, authenticated;/.test(sql), 'rotina só roda por cron/PS_ADMIN')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_sugestao_reabrir\(uuid\) TO authenticated;/.test(sql), 'reabrir é chamável pelo cliente logado')
ok(/'0 11 \* \* 1-5'/.test(sql), 'cron diário em dia útil, horário comercial')
ok(!/DELETE\s+FROM/i.test(sql) && !/DROP\s+/i.test(sql), 'nada é apagado (RD-30)')

if (falhas) { console.error(`\ncheck-chamado-confirmacao-automatica: ${falhas} falha(s)`); process.exit(1) }
console.log('\nChamados · confirmação automática: ok')
