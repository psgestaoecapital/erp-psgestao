// Gate CH-116 — sync do ponto inativa quem saiu (sem apagar), cron sincroniza colaboradores, migration aditiva.
import { readFileSync } from 'node:fs'
let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const sync = readFileSync('src/app/api/industrial/ponto/sync/route.ts', 'utf8')
const cron = readFileSync('src/app/api/cron/ponto-diario/route.ts', 'utf8')
const mig = readFileSync('supabase/migrations/20261015130000_ponto_colaborador_ativo.sql', 'utf8')
ok(/ativo: true, desativado_em: null/.test(sync), 'sync: colaborador devolvido pelo provider fica ativo (reativa)')
ok(/update\(\{ ativo: false/.test(sync) && /\.lt\('sincronizado_em', inicioColeta\)/.test(sync), 'sync: inativa quem sumiu do provider')
ok(sync.indexOf('upsert(rows') < sync.indexOf('update({ ativo: false') && /if \(colabs\.length > 0\)/.test(sync), 'sync: só inativa depois do upsert ok e com lista não vazia')
ok(!/\.delete\(\)/.test(sync), 'sync: nunca apaga colaborador')
ok(/api\/industrial\/ponto\/sync\?company_id=/.test(cron) && /plant_id/.test(cron), 'cron: sincroniza a lista de colaboradores a cada rodada')
ok(/ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true/.test(mig) && !/\b(UPDATE|DELETE|DROP)\b/i.test(mig.replace(/--.*$/gm, '')), 'migration: aditiva, default true, sem UPDATE/DELETE/DROP')
if (falhas) process.exit(1)
