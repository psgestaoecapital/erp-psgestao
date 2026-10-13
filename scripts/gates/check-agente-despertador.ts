/**
 * Gate de build (CEO 04/10): despertador automático dos agentes (fn_agente_despertador).
 * Segura os freios que o CEO exigiu:
 *   1) função só de serviço (guarda do canal + REVOKE de anon/authenticated), SECURITY DEFINER com search_path fixo;
 *   2) um disparo por agente por rodada (LIMIT 1 por agente com acionamento ligado);
 *   3) nunca dispara mensagem com requer_ok_ceo sem ok_ceo_em; só recebida/em_andamento parada há 20 min;
 *   4) teto de 12 redisparos + alerta único em erp_contexto_projeto; histórico de cada redisparo;
 *   5) pg_cron a cada 15 min, jobname agente_despertador, idempotente;
 *   6) nenhuma função de guarda é alterada (RD-91).
 *   npm run gates -- agente-despertador
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(__dirname, '../../supabase/migrations')
const arq = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .find((f) => readFileSync(join(dir, f), 'utf8').includes('FUNCTION public.fn_agente_despertador('))
ok(!!arq, `migration do despertador encontrada (${arq ?? '—'})`)
const s = (arq ? readFileSync(join(dir, arq), 'utf8') : '').replace(/--[^\n]*/g, '')

ok(/FUNCTION public\.fn_agente_despertador\([^)]*\)\s+RETURNS jsonb\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO 'public'/.test(s), 'SECURITY DEFINER com search_path fixo')
ok(/PERFORM public\.fn__agente_assert_servico\(\)/.test(s), 'passa pela guarda do canal protegido')
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_despertador\([^)]*\) FROM PUBLIC, anon, authenticated/.test(s), 'revogada de PUBLIC/anon/authenticated')
ok(!/CREATE OR REPLACE FUNCTION public\.fn__agente_assert_servico/.test(s), 'não altera a função de guarda (RD-91)')
ok(/FROM erp_agente_rotina WHERE aciona/.test(s) && /ORDER BY msg\.criado_em\s+LIMIT 1/.test(s), 'um disparo por agente com acionamento ligado, a mais antiga')
ok(/NOT msg\.requer_ok_ceo OR msg\.ok_ceo_em IS NOT NULL/.test(s), 'nunca dispara sem o OK do CEO')
ok(/msg\.status IN \('recebida','em_andamento'\)/.test(s), 'só recebida/em_andamento')
ok(/p_parado interval DEFAULT interval '20 minutes'/.test(s) && /atualizado_em < now\(\) - p_parado/.test(s) && /'em'\)::timestamptz[^)]*\) < now\(\) - p_parado/.test(s), 'parada há 20 min e último disparo há mais de 20 min')
ok(/p_teto integer DEFAULT 12/.test(s) && /redisparos < p_teto/.test(s), 'teto de 12 redisparos')
ok(/alerta_teto_em IS NULL/.test(s) && /INSERT INTO erp_contexto_projeto/.test(s), 'alerta único ao bater o teto')
ok(/acionamento_historico = acionamento_historico/.test(s), 'cada redisparo no histórico da mensagem')
ok(/cron\.schedule\('agente_despertador', '\*\/15 \* \* \* \*'/.test(s) && /cron\.unschedule\('agente_despertador'\)/.test(s), 'pg_cron a cada 15 min, idempotente')
ok(!/DROP |DELETE |TRUNCATE/i.test(s), 'migration aditiva (sem DROP/DELETE/TRUNCATE)')

if (falhas) { console.error(`\n[check-agente-despertador] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-agente-despertador] despertador: freios, OK do CEO e agendamento conferidos.')
