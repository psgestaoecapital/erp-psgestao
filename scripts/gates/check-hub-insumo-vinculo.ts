/**
 * Gate de build · Hub FC, integração estoque × obra (passo 1): a migration do vínculo insumo × produto é ADITIVA e segura
 * (RLS por empresa, REVOKE de anon, sem UPDATE/DELETE em dado de cliente, segundos 05 no timestamp).
 */
import { readdirSync, readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_hub_insumo_produto_vinculo.sql'))
ok(!!arq, 'migration do vínculo insumo × produto existe')
if (arq) {
  const sql = readFileSync(`${dir}/${arq}`, 'utf8')
  ok(/^\d{12}05_/.test(arq), 'timestamp com segundos 05 (faixa do gilberto-produto)')
  ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /get_user_company_ids\(\)/.test(sql), 'RLS ligada com policy por empresa')
  ok(/REVOKE ALL ON public\.m16_insumo_produto_vinculo FROM PUBLIC, anon/.test(sql), 'tabela com REVOKE de anon')
  ok(/REVOKE ALL ON FUNCTION public\.fn_insumo_vincular_produto[^;]*anon/.test(sql)
    && /REVOKE ALL ON FUNCTION public\.fn_insumo_custo_vivo[^;]*anon/.test(sql), 'funções com REVOKE de anon')
  ok(!/\bDROP (TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE FROM\b/i.test(sql), 'sem DROP/TRUNCATE/DELETE')
  ok(!/\bUPDATE\s+(public\.)?(m16_insumos|erp_produtos)\b/i.test(sql), 'não altera insumo nem produto existente')
  ok(/ON DELETE RESTRICT/.test(sql), 'produto do estoque não some com o vínculo')
}

if (falhas > 0) { console.error(`\n[check-hub-insumo-vinculo] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-hub-insumo-vinculo] vínculo insumo × produto conferido.')
