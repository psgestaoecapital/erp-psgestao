/**
 * Gate de build (Eng. Chefe 12/10): detector de sessão morta — lease fantasma, órfãs re-enfileiradas, fóssil só alertado.
 *   npm run gates -- detector-sessao-morta
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const arq = '20261019123000_detector_sessao_morta_autoressuscita.sql'
const s = readFileSync(join(__dirname, '../../supabase/migrations', arq), 'utf8').replace(/--[^\n]*/g, '')

for (const f of ['fn_agente_detectar_sessao_morta', 'fn_agente_fossil_listar'])
  ok(new RegExp(`FUNCTION public\\.${f}\\([^)]*\\)\\s+RETURNS \\w+\\s+LANGUAGE \\w+\\s+(STABLE\\s+)?SECURITY DEFINER\\s+SET search_path TO 'public'`).test(s), `${f}: SECURITY DEFINER com search_path fixo`)
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_detectar_sessao_morta\(boolean\) FROM PUBLIC, anon, authenticated/.test(s), 'detector revogado de PUBLIC/anon/authenticated')
ok(/fn__agente_assert_servico\(\)/.test(s), 'passa pela guarda do canal protegido')
ok(/ENABLE ROW LEVEL SECURITY/.test(s) && /REVOKE ALL ON TABLE public\.erp_agente_detector_log/.test(s), 'log com RLS e sem acesso anon/authenticated')
ok(/l\.renovada_em < now\(\) - interval '10 minutes'/.test(s) && /DELETE FROM erp_agente_sessao_lease/.test(s), 'lease fantasma (> 10 min) é limpa')
ok(/SET status = 'recebida', iniciada_em = NULL/.test(s) && /interval '15 minutes'/.test(s) && /interval '24 hours'/.test(s), 'órfã re-enfileirada (> 15 min, <= 24 h)')
ok(!/UPDATE erp_agente_mensagem SET arquivada/i.test(s), 'fóssil nunca é arquivado em massa')
ok(/cron\.schedule\('agente_detector_sessao_morta', '\*\/5 \* \* \* \*'/.test(s), 'pg_cron a cada 5 min')
ok(!/CREATE OR REPLACE FUNCTION public\.fn__agente_assert_servico/.test(s), 'não altera a função de guarda (RD-91)')

if (falhas) { console.error(`\n[check-detector-sessao-morta] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-detector-sessao-morta] detector conferido.')
