// Gate (CEO 16/10 20:30, RD-97): confirmação automática de chamados — aviso com 3 dias úteis, conclusão com 5,
// backlog com aviso no 1º ciclo e conclusão 2 dias úteis depois, reabrir em até 30 dias. Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261017230010_chamados_confirmacao_automatica.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(/>= 3 THEN 'avisar'/.test(sql), 'aviso com 3 dias úteis')
ok(/fn_sugestao_somar_du\(p_aprovada, 5\)/.test(sql) && /fn_sugestao_somar_du\(p_hoje, 2\)/.test(sql), 'conclusão com 5 dias úteis; backlog 2 dias úteis depois do aviso')
ok(/fn_e_feriado_nacional\(d\)/.test(sql) && /isodow FROM d\) < 6/.test(sql), 'dia útil = seg–sex sem feriado nacional')
ok(/m\.papel = 'autor'\s+AND m\.criado_em > s\.resposta_aprovada_em/.test(sql), 'resposta do cliente cancela a conclusão automática')
ok(/WHERE s\.status = 'aguardando_confirmacao'/.test(sql) && /AND status = 'aguardando_confirmacao'/.test(sql), 'só mexe em chamado aguardando_confirmacao')
ok(/concluído automaticamente após 5 dias úteis sem retorno do cliente/.test(sql), 'histórico registra a conclusão automática com o texto do CEO')
ok(/interval '30 days'/.test(sql) && /'prazo_de_30_dias_vencido'/.test(sql), 'reabrir só até 30 dias da conclusão')
ok(/prioridade = 'alta'/.test(sql) && /agente = NULL/.test(sql), 'reaberto volta para a carteira do Code responsável com prioridade')
ok(sql.includes('REVOKE ALL ON FUNCTION public.fn_sugestao_autoconfirmar() FROM PUBLIC, anon, authenticated;'), 'rotina não é chamável pelo cliente')
ok(/cron\.schedule\('sugestao-autoconfirmar-diario', '0 12 \* \* 1-5'/.test(sql), 'cron em dias úteis, horário comercial')
ok(!/DELETE\s+FROM/i.test(sql), 'nada é apagado (RD-30)')
const tela = readFileSync('src/app/dashboard/melhorias/page.tsx', 'utf8')
ok(tela.includes("fn_sugestao_reabrir") && tela.includes('melhorias.reabrir'), 'tela tem Reabrir com "?" (RD-95)')

if (falhas) { console.error(`\ncheck-chamados-confirmacao-automatica: ${falhas} falha(s)`); process.exit(1) }
console.log('\nChamados · confirmação automática: ok')
