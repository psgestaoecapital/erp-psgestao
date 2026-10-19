// Gate (CEO 16/10, RD-97): confirmação automática de chamados — 3 dias úteis avisa, 5 conclui, reabrir em 30 dias. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const arq = readdirSync('supabase/migrations').find((f) => f.endsWith('_chamado_confirmacao_automatica.sql'))
const sql = arq ? readFileSync(`supabase/migrations/${arq}`, 'utf8') : ''
const tela = readFileSync('src/app/dashboard/melhorias/page.tsx', 'utf8')

ok(!!arq, 'migration da confirmação automática existe')
ok(/status = 'aguardando_confirmacao'/.test(sql) && !/status = 'em_analise'/.test(sql), 'só mexe em aguardando_confirmacao')
ok(/fn_dias_uteis_entre\(v_base, p_hoje\) >= 3/.test(sql), 'aviso com 3 dias úteis')
ok(/fn_dias_uteis_entre\(v_base, p_hoje\) >= 5/.test(sql) && /fn_dias_uteis_entre\(v_aviso, p_hoje\) >= 2/.test(sql), 'conclusão com 5 dias úteis e 2 depois do aviso')
ok(/fn_e_feriado_nacional/.test(sql) && /isodow/.test(sql), 'dias úteis = seg a sex sem feriado nacional')
ok(/m\.papel = 'autor'/.test(sql) && /aviso_conclusao_auto_em = NULL/.test(sql), 'resposta do cliente cancela a conclusão')
ok(/concluído automaticamente após 5 dias úteis sem retorno do cliente/.test(sql), 'histórico registra o motivo exigido')
ok(/interval '30 days'/.test(sql) && /fn_sugestao_reabrir/.test(sql), 'reabertura em até 30 dias')
ok(/REVOKE ALL ON FUNCTION public\.fn_sugestao_confirmacao_automatica\(date\) FROM PUBLIC, anon, authenticated/.test(sql), 'rotina só para serviço/cron')
ok(/cron\.schedule\('sugestao-confirmacao-automatica', '15 11 \* \* 1-5'/.test(sql), 'cron seg–sex')
ok(/fn_sugestao_reabrir/.test(tela) && /chamado-reabrir/.test(tela), 'tela tem o botão Reabrir chamado')
if (falhas) process.exit(1)
