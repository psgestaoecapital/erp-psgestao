// Gate (#4917, jordana-code 27/10): a migration que desliga o Omie da Gean e da Toy Tintas só toca essas duas empresas,
// guarda backup antes de gravar e nunca mexe em R.R, M.M, Tryo Acabamentos e Tryo Gesso (decisão da Jordana 26/10).
// Sem rede, banco ou variável.
import { readdirSync, readFileSync } from 'node:fs'

// acha a migration pelo sufixo: a fila pode renumerar a versão sem quebrar o gate
const ARQ = 'supabase/migrations/' + (readdirSync('supabase/migrations').find((f) => f.endsWith('_omie_desligar_gean_toy_4917.sql')) ?? '_omie_desligar_gean_toy_4917.sql')
const GEAN = 'a462e13f-0f51-4c54-abe8-4474b591633b'
const TOY = '22a7f4fd-149d-47ee-8dd2-bfbb4c897f58'
const FICAM = {
  'R.R': 'd1330faf-78f8-40fc-904f-711a6e4b7352',
  'M.M': '1163bb56-616b-435d-a9a3-621e562dfb55',
  'Tryo Acabamentos': '50b1da9b-7367-4489-8b50-e62dd6efc760',
  'Tryo Gesso': '918c3ea4-770d-4a10-9200-f9c21f92a1f6',
}

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync(ARQ, 'utf8').replace(/--[^\n]*/g, '')
const uuids = new Set(sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])
ok(uuids.size === 2 && uuids.has(GEAN) && uuids.has(TOY), 'só os uuids da Gean e da Toy Tintas aparecem')
for (const [nome, id] of Object.entries(FICAM)) ok(!uuids.has(id), `${nome} não é tocada`)
const updates = [...sql.matchAll(/UPDATE\s+(\w+)\s+SET[\s\S]*?WHERE([\s\S]*?);/gi)]
ok(updates.length === 2, 'dois UPDATEs (config e pendentes)')
for (const [, tabela, where] of updates) {
  ok(/company_id\s*(IN\s*\(\s*v_gean\s*,\s*v_toy\s*\)|=\s*v_gean)/i.test(where), `UPDATE em ${tabela} filtra pela empresa`)
  ok(/provider\s*=\s*'omie'/i.test(where), `UPDATE em ${tabela} filtra provider = 'omie'`)
}
const iBkp = sql.indexOf('INSERT INTO public._bkp_omie_4917_20261027')
ok(iBkp > 0 && iBkp < sql.search(/UPDATE\s+erp_provider_config/i), 'backup gravado antes do UPDATE')
ok(/REVOKE ALL ON public\._bkp_omie_4917_20261027 FROM PUBLIC, anon, authenticated/.test(sql), 'backup fechado (RLS + REVOKE)')
ok(!/\b(DELETE|TRUNCATE|DROP)\b/i.test(sql), 'sem DELETE/TRUNCATE/DROP')

if (falhas) { console.error(`\ncheck-omie-desligar-4917: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-omie-desligar-4917: ok')
