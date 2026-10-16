// Gate (CEO 16/10, RD-97): confirmação automática de chamado — aviso com 3 dias úteis, conclusão com 5, reabrir em 30 dias.
// Estático, sem rede. A prova dos prazos (fim de semana, feriado, resposta do cliente, 30 dias) rodou em transação desfeita
// contra o banco e está no corpo da PR.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261017060010_chamado_confirmacao_automatica.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(/fn__dias_uteis_entre\(v_base, v_hoje\) >= 3/.test(sql), 'aviso com 3 dias úteis sem resposta')
ok(/GREATEST\(public\.fn__dias_uteis_somar\(v_base, 5\), public\.fn__dias_uteis_somar\(v_hoje, 2\)\)/.test(sql), 'limite = 5 dias úteis (backlog: aviso + 2 dias úteis)')
ok(/fn_e_feriado_nacional/.test(sql) && /isodow/.test(sql), 'dias úteis = segunda a sexta sem feriado nacional')
ok(/v_ult_autor > v_base_ts/.test(sql), 'resposta do cliente cancela a conclusão automática')
ok(/concluído automaticamente após 5 dias úteis sem retorno do cliente/.test(sql), 'histórico registra a conclusão automática')
ok(/status = 'aguardando_confirmacao'/.test(sql) && /is_demo/.test(sql), 'só aguardando_confirmacao, fora de empresa demo')
ok(/interval '30 days'/.test(sql) && /so_o_autor_reabre/.test(sql), 'reabrir: só o autor, em até 30 dias')
ok(/prioridade = 'alta'/.test(sql) && /atendente_id = NULL/.test(sql), 'reaberto volta à fila do Code com prioridade')
ok(!/DELETE\s+FROM/i.test(sql), 'nada é apagado (RD-30)')
ok(sql.includes('REVOKE ALL ON FUNCTION public.fn_chamado_confirmacao_automatica(timestamptz) FROM PUBLIC, anon, authenticated;'), 'rotina não é chamável pelo cliente')
ok(/cron\.schedule\('chamado-confirmacao-automatica', '0 11 \* \* 1-5'/.test(sql), 'cron em dias úteis, 08:00 BRT')
const tela = readFileSync('src/app/dashboard/melhorias/page.tsx', 'utf8')
ok(tela.includes("rpc('fn_sugestao_reabrir'") && tela.includes('chamado-reabrir'), 'tela: botão Reabrir chamado')

if (falhas) { console.error(`\ncheck-chamado-confirmacao-automatica: ${falhas} falha(s)`); process.exit(1) }
console.log('\nChamados · confirmação automática: ok')
