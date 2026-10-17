// Gate (CEO 16/10 20:30, RD-97) — confirmação automática de chamados: aviso com 3 dias úteis, conclusão com 5,
// resposta do cliente cancela, cliente reabre em até 30 dias, backlog avisa e conclui 2 dias úteis depois. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261017200010_chamado_confirmacao_automatica.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(/status = 'aguardando_confirmacao'/.test(sql) && /fn_chamado_dias_uteis_entre\(v_ref_d, v_hoje\) < 3/.test(sql), 'aviso só com 3 dias úteis sem retorno')
ok(/fn_chamado_somar_dias_uteis\(v_hoje, 2\)/.test(sql) && /v_hoje >= r\.conclusao_prevista_em/.test(sql), 'conclui 2 dias úteis depois do aviso (5 no total; backlog igual)')
ok(/m\.papel = 'autor'/.test(sql) && /aviso_conclusao_em < v_ref/.test(sql), 'resposta do cliente cancela o aviso/conclusão')
ok(/interval '30 days'/.test(sql) && /so_o_autor_reabre/.test(sql), 'cliente (autor) reabre em até 30 dias')
ok(/concluído automaticamente após 5 dias úteis sem retorno do cliente/.test(sql), 'histórico registra a conclusão automática')
ok(/fn_e_feriado_nacional/.test(sql) && /isodow/.test(sql), 'dias úteis = seg-sex sem feriado nacional')
ok(!/DELETE\s+FROM/i.test(sql) && !/CREATE OR REPLACE FUNCTION public\.fn_sugestao_confirmar/.test(sql), 'nada apagado e função existente não é reescrita')
ok(/REVOKE ALL ON FUNCTION public\.fn_chamado_confirmacao_automatica\(timestamptz\) FROM PUBLIC, anon/.test(sql), 'rotina sem acesso anon')
ok(/cron\.schedule\('chamado-confirmacao-automatica'/.test(sql), 'agendada em dias úteis')

if (falhas) { console.error(`\ncheck-chamado-confirmacao-automatica: ${falhas} falha(s)`); process.exit(1) }
console.log('\nChamados · confirmação automática: ok')
