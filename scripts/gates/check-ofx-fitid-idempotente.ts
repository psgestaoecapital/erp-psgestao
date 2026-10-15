/**
 * Gate (chamado Troian OFX): a importação do OFX é idempotente por FITID — nunca aborta o lote inteiro por
 * duplicate key em uniq_conciliacao_movimento_company_idexterno.
 *   tsx scripts/gates/check-ofx-fitid-idempotente.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const sql = readFileSync('supabase/migrations/20261015140030_ofx_fitid_idempotente.sql', 'utf8')
ok(/CREATE OR REPLACE FUNCTION public\.fn_conciliacao_criar_lote/.test(sql), 'redefine fn_conciliacao_criar_lote')
ok(/WHERE company_id = p_company_id AND id_externo = v_fitid/.test(sql), 'confere FITID existente por (company_id, id_externo) antes do INSERT')
ok(/lote_id <> v_lote_id[\s\S]{0,120}data_transacao = v_data/.test(sql), 'mesmo FITID + mesma data/valor em outro lote → ignora')
ok(/v_fitid := v_fitid \|\| '~'/.test(sql), 'FITID distinto reaproveitado entra com sufixo (não viola o índice)')
ok(/REVOKE EXECUTE[\s\S]*FROM anon, public/.test(sql), 'REVOKE de anon/public mantido')
ok(!/DROP INDEX|DELETE FROM conciliacao_movimento WHERE (?!lote_id = v_lote_id)/.test(sql), 'não apaga índice nem dado de cliente')

if (falhas) { console.error(`\n[check-ofx-fitid-idempotente] ${falhas} regra(s) quebrada(s).`); process.exit(1) }
console.log('\n[check-ofx-fitid-idempotente] importação OFX idempotente por FITID conferida.')
