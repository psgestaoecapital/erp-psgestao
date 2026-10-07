import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261007190005_hub_aplicar_papeis_fc_pisos.sql', 'utf8')
const falhas: string[] = []
const exige = (ok: boolean, msg: string) => { if (!ok) falhas.push(msg) }

exige(sql.includes("'b202b50f-37cb-462e-accf-126869de49f0'"), 'só a FC Pisos (company_id fixo)')
exige(!/FROM user_scope[^;]*;\s*DELETE|DELETE FROM/i.test(sql), 'sem DELETE')
exige(sql.includes('_bkp_fc_papeis_hub_20261007'), 'backup do vínculo atual')
exige(/RAISE EXCEPTION 'Catálogo de papéis do Hub/.test(sql), 'aborta se o catálogo do Hub não existir')
exige(sql.includes('RD-36'), 'observação RD-36')
exige(sql.includes("equipe_ps"), 'prova de que a equipe PS não foi tocada')
for (const slug of ['hub_socio', 'hub_gerente_obras', 'hub_engenheiro', 'hub_financeiro', 'hub_compras', 'hub_rh'])
  exige(sql.includes(slug), `papel ${slug} aplicado`)

if (falhas.length) { console.error('check-hub-aplicar-papeis-fc:\n- ' + falhas.join('\n- ')); process.exit(1) }
console.log('check-hub-aplicar-papeis-fc OK')
