/**
 * Gate (chamado Troian OFX): FITID não é chave única da conciliação (Bradesco reaproveita FITID entre exportações);
 * a dedup é por conteúdo, dentro de fn_conciliacao_criar_lote.
 *   tsx scripts/gates/check-ofx-dedup-conteudo.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const sql = readFileSync('supabase/migrations/20261015235030_ofx_dedup_por_conteudo_sem_unico_fitid.sql', 'utf8')
for (const ix of ['uniq_conciliacao_movimento_company_idexterno', 'uq_mov_lote_id_externo', 'ux_conciliacao_movimento_idext'])
  ok(new RegExp(`DROP INDEX IF EXISTS public\\.${ix}`).test(sql), `retira o índice único ${ix}`)
ok(/CREATE INDEX IF NOT EXISTS idx_conciliacao_movimento_company_id_externo/.test(sql), 'mantém busca por id_externo (índice comum)')
ok(!/CREATE UNIQUE INDEX[^;]*id_externo/i.test(sql), 'nenhum índice único novo por id_externo')
ok(!/DELETE|UPDATE|TRUNCATE/i.test(sql.replace(/--.*$/gm, '')), 'não altera nem apaga dado de cliente')

// Sync por API (fn_extrato_importar_sistema) usa a mesma chave de conteúdo — sem os índices únicos por FITID ela ficaria sem trava.
const api = readFileSync('supabase/migrations/20261016000030_ofx_dedup_conteudo_cobre_sync_api.sql', 'utf8').replace(/--.*$/gm, '')
ok(/CREATE OR REPLACE FUNCTION public\.fn_extrato_importar_sistema/.test(api), 'sync por API redefinida')
ok(/_api_conc/.test(api) && /n_banco >= COALESCE\(v_n_arq, 1\)/.test(api), 'sync por API deduplica por conteúdo com contador de ocorrência')
ok(/cm\.natureza/.test(api) && /descricao_normalizada = v_dnorm/.test(api), 'chave inclui natureza e descrição normalizada')
ok((api.match(/pg_advisory_xact_lock/g) ?? []).length === 2, 'OFX e API serializam por empresa+conta (advisory lock)')
ok(!/CREATE UNIQUE INDEX[^;]*id_externo/i.test(api) && !/DELETE FROM conciliacao_movimento WHERE (?!lote_id = v_lote_id)/.test(api), 'sem índice único por id_externo nem DELETE de dado de cliente')

// Pluggy (sp_pluggy_promover_para_conciliacao) dependia de unique_violation do índice removido: checagem explícita + lock.
const pl = readFileSync('supabase/migrations/20261016010030_pluggy_promover_dedup_sem_unique_violation.sql', 'utf8').replace(/--.*$/gm, '')
ok(/CREATE OR REPLACE FUNCTION public\.sp_pluggy_promover_para_conciliacao/.test(pl), 'Pluggy: função redefinida')
ok(!/unique_violation/.test(pl), 'Pluggy: não depende mais de unique_violation')
ok(/IF EXISTS \(SELECT 1 FROM conciliacao_movimento cm WHERE cm\.company_id = v_item\.company_id AND cm\.id_externo = v_id_ext\)/.test(pl), 'Pluggy: checa existência por empresa + id_externo antes de inserir')
ok(/pg_advisory_xact_lock/.test(pl) && /SECURITY DEFINER/.test(pl) && /SET search_path TO 'public'/.test(pl), 'Pluggy: advisory lock e SECURITY DEFINER/search_path preservados')
ok(!/DELETE|TRUNCATE|DROP/i.test(pl), 'Pluggy: sem DELETE/DROP')

if (falhas) { console.error(`\n[check-ofx-dedup-conteudo] ${falhas} regra(s) quebrada(s).`); process.exit(1) }
console.log('\n[check-ofx-dedup-conteudo] dedup por conteúdo conferida.')
