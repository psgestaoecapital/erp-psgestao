// Gate: Hub — aplicar papéis na FC Pisos (só a FC, backup, prova antes/depois, sem tocar user_companies/FCR/equipe PS).
import { readFileSync } from 'node:fs'

const falhas: string[] = []
const ok = (c: boolean, m: string) => { if (!c) falhas.push(m) }
const sql = readFileSync('supabase/migrations/20261007160005_hub_aplicar_papeis_fc_pisos.sql', 'utf8')
const cod = sql.replace(/--.*$/gm, '')
ok(cod.includes("'b202b50f-37cb-462e-accf-126869de49f0'"), 'escopo: id da FC Pisos')
ok(!cod.includes('3ddcaac8-7a54-4845-8d1b-835dfc11bd68'), 'FCR não é tocada')
ok(!/\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i.test(cod), 'sem DELETE/TRUNCATE/DROP')
ok(!/UPDATE\s+user_companies/i.test(cod), 'user_companies.role não muda')
ok(cod.includes('_bkp_hub_papeis_fc_20261007') && /ENABLE ROW LEVEL SECURITY/.test(cod) && /REVOKE ALL[^;]*anon/.test(cod), 'backup com RLS e REVOKE anon')
ok(/RAISE EXCEPTION 'Prova depois/.test(cod) && /RAISE EXCEPTION 'Catálogo/.test(cod), 'prova depois e guarda do catálogo')
for (const e of ['diego@fcpisos.com', 'diego@fcpiso.com', 'ervimpaterno@gmail.com', 'administrativo@fcpisos.com', 'compras@fcpisos.com', 'deborad@fcpisos.com', 'analuisa@fcpisos.com', 'raquel@fcpisos.com'])
  ok(cod.includes(`'${e}'`), `mapeia ${e}`)
ok(!/psgestao|jordanacarolinar|rodrigo\.rjantsch|andreluizsalvi|gilberto\.paravizi/.test(cod), 'equipe PS fora')
if (falhas.length) { console.error('✗ check-hub-aplicar-papeis-fc:\n - ' + falhas.join('\n - ')); process.exit(1) }
console.log('✓ check-hub-aplicar-papeis-fc')
