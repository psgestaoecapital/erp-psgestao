/**
 * Gate (chamado Troian OFX): FITID não é chave única da conciliação (Bradesco reaproveita FITID entre exportações);
 * a dedup é por conteúdo, dentro de fn_conciliacao_criar_lote.
 *   tsx scripts/gates/check-ofx-dedup-conteudo.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const sql = readFileSync('supabase/migrations/20261015150030_ofx_dedup_por_conteudo_sem_unico_fitid.sql', 'utf8')
for (const ix of ['uniq_conciliacao_movimento_company_idexterno', 'uq_mov_lote_id_externo', 'ux_conciliacao_movimento_idext'])
  ok(new RegExp(`DROP INDEX IF EXISTS public\\.${ix}`).test(sql), `retira o índice único ${ix}`)
ok(/CREATE INDEX IF NOT EXISTS idx_conciliacao_movimento_company_id_externo/.test(sql), 'mantém busca por id_externo (índice comum)')
ok(!/CREATE UNIQUE INDEX[^;]*id_externo/i.test(sql), 'nenhum índice único novo por id_externo')
ok(!/DELETE|UPDATE|TRUNCATE/i.test(sql.replace(/--.*$/gm, '')), 'não altera nem apaga dado de cliente')

if (falhas) { console.error(`\n[check-ofx-dedup-conteudo] ${falhas} regra(s) quebrada(s).`); process.exit(1) }
console.log('\n[check-ofx-dedup-conteudo] dedup por conteúdo conferida.')
