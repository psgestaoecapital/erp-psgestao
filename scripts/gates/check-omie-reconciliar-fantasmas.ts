// Gate (chamado #2711 · reconciliação OMIE): a função é segura por construção — dry-run por padrão, só admin,
// aplicar exige empresa, soft delete (nunca DELETE) e título quitado nunca é removido. Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const sql = readFileSync('supabase/migrations/20261017140030_omie_reconciliar_fantasmas.sql', 'utf8')

ok(/p_aplicar boolean DEFAULT false/.test(sql), 'dry-run por padrão (p_aplicar = false)')
ok(/auth\.uid\(\) IS NOT NULL AND NOT is_admin\(\)/.test(sql), 'só admin chama')
ok(/p_aplicar AND p_company_id IS NULL[\s\S]*aplicar_exige_company_id/.test(sql), 'aplicar exige company_id (uma empresa por vez)')
ok(!/\bDELETE\s+FROM\b/i.test(sql), 'nunca DELETE: remoção é soft delete')
ok(/SET deleted_at = now\(\), deleted_by = auth\.uid\(\)/.test(sql), 'soft delete grava deleted_at/deleted_by')
ok(/AND status <> %2\$L AND NOT \(ref_externa_id = ANY\(\$3\)\)/.test(sql), 'o UPDATE nunca atinge título quitado (pago/recebido)')
ok(/'pago'\)[\s\S]*'recebido'\)/.test(sql), 'quitado = pago (pagar) e recebido (receber)')
ok(/jsonb_array_length\(v_snap\.import_data->v_lado\.chave\) <> v_snap\.record_count/.test(sql) && /snapshot_incompleto/.test(sql), 'só snapshot completo')
ok(/record_count >= 10000/.test(sql) && /snapshot_antigo/.test(sql), 'sem snapshot no teto de paginação nem antigo')
ok(/created_at <= \$2/.test(sql), 'só lançamento criado até o snapshot')
ok(/upper\(ref_externa_sistema\) = 'OMIE'/.test(sql), 'só lançamento de origem OMIE')
ok(/REVOKE ALL ON FUNCTION public\.fn_omie_reconciliar_fantasmas\(uuid, boolean, int\) FROM PUBLIC, anon/.test(sql), 'REVOKE de anon')
if (falhas) process.exit(1)
