// Gate · PM-T (3) — etapa e rodada automáticas no lançamento de horas. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const sql = readFileSync('supabase/migrations/20261007100005_pm_t3_etapa_rodada_automaticas.sql', 'utf8')

ok(/ADD COLUMN IF NOT EXISTS rodada integer/.test(sql), 'coluna rodada aditiva e idempotente')
ok(/BEFORE INSERT ON public\.agency_timesheet/.test(sql) && /DROP TRIGGER IF EXISTS/.test(sql), 'gatilho só no INSERT, recriável')
ok(/etapa_tipo IS NULL/.test(sql) && /rodada IS NULL/.test(sql), 'só preenche o que veio vazio')
ok(/rodada_ajuste/.test(sql) && /'aprovacao_job'/.test(sql) && /'publicacao'/.test(sql), 'etapa pela situação, rodada pelo job')
ok(/REVOKE ALL ON FUNCTION public\.fn_pm_timesheet_etapa_rodada\(\) FROM PUBLIC, anon/.test(sql), 'REVOKE de anon')
ok(!/\b(DELETE FROM|UPDATE public|TRUNCATE|DROP TABLE)\b/.test(sql), 'sem UPDATE/DELETE em dado de cliente')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
