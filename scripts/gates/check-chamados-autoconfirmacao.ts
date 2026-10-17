// Gate (CEO 16/10, RD-97): confirmação automática de chamados — aviso 3 du, conclusão 5 du, reabrir 30 dias. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261018010000_chamados_autoconfirmacao.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(/fn_sugestao_somar_dias_uteis\(v_d0, 3\)/.test(sql), 'aviso com 3 dias úteis')
ok(/fn_sugestao_somar_dias_uteis\(\(p_aviso_em AT TIME ZONE 'America\/Sao_Paulo'\)::date, 2\)/.test(sql), 'conclusão 2 dias úteis depois do aviso (5 no total)')
ok(/fn_e_feriado_nacional/.test(sql) && /isodow FROM p_data\) < 6/.test(sql), 'dias úteis = segunda a sexta sem feriado nacional')
ok(/m\.papel = 'autor' AND m\.criado_em > s\.resposta_aprovada_em/.test(sql), 'resposta do cliente cancela a conclusão')
ok(/interval '30 days'/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.fn_sugestao_reabrir\(uuid\) TO authenticated/.test(sql), 'reabrir em até 30 dias, pelo cliente')
ok(/REVOKE ALL ON FUNCTION public\.fn_sugestao_autoconfirmar\(timestamptz\) FROM PUBLIC, anon, authenticated/.test(sql), 'rotina só roda pelo cron/serviço')
ok(/concluído automaticamente após 5 dias úteis sem retorno do cliente/.test(sql), 'histórico registra a conclusão automática')
ok(!/DELETE\s+FROM/i.test(sql), 'nada é apagado (RD-30)')
const tela = readFileSync('src/app/dashboard/melhorias/page.tsx', 'utf8')
ok(tela.includes("fn_sugestao_reabrir") && tela.includes('chave="chamado.reabrir"'), 'botão Reabrir na tela, com "?" (RD-95)')

if (falhas) { console.error(`\ncheck-chamados-autoconfirmacao: ${falhas} falha(s)`); process.exit(1) }
console.log('\nChamados · confirmação automática: ok')
