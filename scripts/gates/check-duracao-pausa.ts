/**
 * Gate de build (#272 · Frioeste SST): pausa de 19:25 (relatório com segundos, horários 07:42→08:02) é INSUFICIENTE —
 * a apuração não pode recalcular pelos horários (20 min exatos) e esconder o desvio.
 *   tsx scripts/check-duracao-pausa.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { duracaoPausaSeg, pausaInsuficiente } from '../../src/lib/ponto/duracaoPausa'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

// caso real do chamado: Anderson, 16/09
const anderson = { inicio: '2026-09-16T07:42:00-03:00', fim: '2026-09-16T08:02:00-03:00', duracao_seg: 1165 }
ok(duracaoPausaSeg(anderson) === 1165, 'usa a duração do relatório (19:25 = 1165 s), não os horários (20:00)')
ok(pausaInsuficiente(anderson) === true, 'pausa de 19:25 é insuficiente (mínimo 20 min)')
ok(pausaInsuficiente({ ...anderson, duracao_seg: null }) === false, 'sem duração no arquivo, usa fim − início (20 min = cumpre)')
ok(duracaoPausaSeg({ ...anderson, fim_confirmado: '2026-09-16T08:05:00-03:00' }) === 1380, 'fim confirmado na Conferência manda (23 min)')
ok(duracaoPausaSeg({ inicio: anderson.inicio, fim: null }) === null, 'pausa sem fim não tem duração (não vira cumprida nem insuficiente)')

// a migration aplica a MESMA regra na apuração
const mig = readdirSync('supabase/migrations').find(f => f.includes('nr36_272_duracao_do_arquivo'))
const sql = mig ? readFileSync(`supabase/migrations/${mig}`, 'utf8') : ''
ok(!!mig, 'migration do #272 presente')
ok(/WHEN p_fim_confirmado IS NOT NULL THEN EXTRACT\(EPOCH FROM \(p_fim_confirmado - p_inicio\)\)/.test(sql)
  && /WHEN p_fim IS NOT NULL THEN COALESCE\(p_duracao_seg::numeric, EXTRACT\(EPOCH FROM \(p_fim - p_inicio\)\)\)/.test(sql),
  'fn_nr36_duracao_seg tem a mesma regra (confirmado → arquivo → horários)')
ok(sql.includes("replace(v_def, 'EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))'"), 'fn_nr36_apurar troca o cálculo pelos horários pela duração do arquivo')

if (falhas) { console.error(`\n[check-duracao-pausa] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-duracao-pausa] duração da pausa conferida.')
