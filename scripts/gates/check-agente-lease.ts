/**
 * Gate de build (CEO 04/10): despertador de 5 min + trava de uma sessão por agente (lease).
 *   1) funções só de serviço: guarda do canal, SECURITY DEFINER com search_path fixo, REVOKE de anon/authenticated;
 *   2) lease expira em 12 min, atômico (ON CONFLICT ... WHERE), renovado por fn_agente_mensagem_responder;
 *   3) fn_agente_acionar e o despertador não disparam com lease ativa;
 *   4) despertador: cron de 5 min, parada > 10 min, teto 18 contado só sem progresso (responder zera);
 *   5) nenhuma função de guarda é alterada (RD-91); migration aditiva.
 *   npm run gates -- agente-lease
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const arq = '20261005110000_agente_lease_despertador_5min.sql'
const s = readFileSync(join(__dirname, '../../supabase/migrations', arq), 'utf8').replace(/--[^\n]*/g, '')

for (const f of ['fn_agente_sessao_iniciar', 'fn__agente_lease_ativa', 'fn_agente_despertador'])
  ok(new RegExp(`FUNCTION public\\.${f}\\([^)]*\\)\\s+RETURNS \\w+\\s+LANGUAGE \\w+\\s+(STABLE\\s+)?SECURITY DEFINER\\s+SET search_path TO 'public'`).test(s), `${f}: SECURITY DEFINER com search_path fixo`)
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_sessao_iniciar\([^)]*\) FROM PUBLIC, anon, authenticated/.test(s), 'sessao_iniciar revogada de PUBLIC/anon/authenticated')
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_despertador\([^)]*\) FROM PUBLIC, anon, authenticated/.test(s), 'despertador revogado de PUBLIC/anon/authenticated')
ok(/PERFORM public\.fn__agente_assert_servico\(\)/.test(s), 'passa pela guarda do canal protegido')
ok(/ON CONFLICT \(agente\) DO UPDATE[\s\S]*WHERE l\.sessao_ref = EXCLUDED\.sessao_ref OR l\.renovada_em < now\(\) - p_validade/.test(s) && /p_validade interval DEFAULT interval '12 minutes'/.test(s), 'lease atômico, expira em 12 min')
ok(/UPDATE erp_agente_sessao_lease SET renovada_em = now\(\) WHERE agente = p_agente/.test(s), 'fn_agente_mensagem_responder renova o lease')
ok(/IF public\.fn__agente_lease_ativa\(m\.para\) THEN[\s\S]*sessao_ativa/.test(s), 'fn_agente_acionar não dispara com lease ativa')
ok(/CONTINUE WHEN public\.fn__agente_lease_ativa\(r\.agente\)/.test(s), 'despertador respeita o lease')
ok(/p_parado interval DEFAULT interval '10 minutes'/.test(s) && /p_teto integer DEFAULT 18/.test(s), 'parada > 10 min e teto 18')
ok(/redisparos\s+= CASE WHEN [^\n]*IS DISTINCT FROM resposta THEN 0/.test(s), 'progresso (resposta nova) zera os redisparos')
ok(/cron\.schedule\('agente_despertador', '\*\/5 \* \* \* \*'/.test(s), 'pg_cron a cada 5 min')
ok(!/CREATE OR REPLACE FUNCTION public\.fn__agente_assert_servico/.test(s), 'não altera a função de guarda (RD-91)')
ok(!/DROP |DELETE |TRUNCATE/i.test(s), 'migration aditiva (sem DROP/DELETE/TRUNCATE)')

if (falhas) { console.error(`\n[check-agente-lease] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-agente-lease] lease e despertador de 5 min conferidos.')
