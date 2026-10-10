/**
 * Gate de build (CEO 08/10): despertador econômico — acorda só quando há motivo.
 *   1) redisparo só após p_parado de 30 min com recuo exponencial (30 min, 1 h, 2 h, 4 h de teto);
 *   2) teto de 6 redisparos seguidos sem progresso + alerta único ao Eng. Chefe;
 *   3) mensagem "aguardando <motivo>" não é redisparada; a marca cai sozinha quando status/resposta/PR mudam;
 *   4) continua respeitando lease, OK do CEO e guarda de serviço; nenhuma função de guarda é alterada (RD-91);
 *   5) relatório de sessões das últimas 24 h por agente (card da aba Codes).
 *   npm run gates -- agente-despertador-economico
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const arq = '20261009010000_despertador_economico.sql'
const s = readFileSync(join(__dirname, '../../supabase/migrations', arq), 'utf8').replace(/--[^\n]*/g, '')

ok(/p_parado interval DEFAULT interval '30 minutes'/.test(s) && /p_teto integer DEFAULT 6/.test(s), 'padrão 30 min e teto de 6 redisparos')
ok(/least\(p_parado \* power\(2, msg\.redisparos\), v_max\)/.test(s) && /v_max interval := interval '4 hours'/.test(s), 'recuo exponencial com teto de 4 h')
ok(/aguardando_motivo IS NULL/.test(s), 'não redispara mensagem aguardando')
ok(/trg_agente_mensagem_limpa_aguardando/.test(s) && /NEW\.status IS DISTINCT FROM OLD\.status/.test(s), 'marca aguardando cai quando a mensagem muda')
ok(/CONTINUE WHEN public\.fn__agente_lease_ativa\(r\.agente\)/.test(s), 'respeita o lease')
ok(/NOT msg\.requer_ok_ceo OR msg\.ok_ceo_em IS NOT NULL/.test(s), 'nunca dispara sem o OK do CEO')
ok(/alerta_teto_em IS NULL/.test(s) && /INSERT INTO erp_contexto_projeto/.test(s), 'alerta único ao bater o teto')
for (const f of ['fn_agente_despertador(interval, integer, uuid, boolean)', 'fn_agente_mensagem_aguardar(uuid, text, text)', 'fn_agente_sessoes_24h()'])
  ok(s.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated`), `${f.split('(')[0]} revogada de PUBLIC/anon/authenticated`)
ok((s.match(/PERFORM public\.fn__agente_assert_servico\(\)/g) ?? []).length === 3, 'as 3 funções passam pela guarda de serviço')
ok(!/CREATE OR REPLACE FUNCTION public\.fn__agente_assert_servico/.test(s), 'não altera a função de guarda (RD-91)')
ok(!/DROP TABLE|DROP COLUMN|DELETE |TRUNCATE/i.test(s), 'migration aditiva')

if (falhas) { console.error(`\n[check-agente-despertador-economico] ${falhas} regra(s) quebrada(s).`); process.exit(1) }
console.log('\n[check-agente-despertador-economico] despertador econômico conferido.')
