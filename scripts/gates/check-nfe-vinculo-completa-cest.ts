/**
 * Gate (#1755 Gean): ligar o item da NF de entrada a um produto SEM CEST completa o CEST pela nota.
 * Travas: só preenche CEST vazio (nunca troca o cadastrado) · só 7 dígitos · só produto da mesma empresa do item ·
 * dispara ao ligar (INSERT ou troca de produto_id), por qualquer caminho (vincular, OS, de-para) · gatilho fechado
 * ao cliente (REVOKE de PUBLIC, anon e authenticated).
 */
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const arq = readdirSync('supabase/migrations').find((f) => f.endsWith('_nfe_item_vinculo_completa_cest.sql'))
ok(!!arq, 'migration _nfe_item_vinculo_completa_cest.sql existe')
const mig = arq ? readFileSync(`supabase/migrations/${arq}`, 'utf8') : ''
const sql = mig.replace(/--[^\n]*/g, '')

ok(/AFTER\s+INSERT\s+OR\s+UPDATE\s+OF\s+produto_id\s+ON\s+public\.erp_nfe_recebidas_itens/i.test(sql), 'gatilho no item da NF ao ligar (INSERT ou troca de produto_id)')
ok(/WHEN\s*\(\s*NEW\.produto_id\s+IS\s+NOT\s+NULL\s*\)/i.test(sql), 'só dispara com produto ligado')
ok(/NEW\.produto_id\s+IS\s+NOT\s+DISTINCT\s+FROM\s+OLD\.produto_id\s+THEN\s+RETURN/i.test(sql), 'UPDATE sem troca de produto não mexe no cadastro')
ok(/length\(v_cest\)\s*<>\s*7\s+THEN\s+RETURN/i.test(sql), 'CEST só com 7 dígitos')
ok(/regexp_replace\(COALESCE\(NEW\.cest,\s*''\),\s*'\\D',\s*'',\s*'g'\)/i.test(sql), 'CEST gravado só com dígitos')
ok(/company_id\s*=\s*NEW\.company_id/i.test(sql), 'só produto da mesma empresa do item')
ok(/NULLIF\(btrim\(COALESCE\(cest,\s*''\)\),\s*''\)\s+IS\s+NULL/i.test(sql), 'nunca troca um CEST já preenchido')
ok(!/\bSET\b[^;]*\b(origem|ncm|cfop_compra|unidade_compra|unidade)\s*=/i.test(sql), 'não mexe em origem, NCM, CFOP nem unidade')
ok(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.tg_nfe_item_completa_cest_produto\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql), 'função do gatilho fechada ao cliente')
ok(!/\bGRANT\b/i.test(sql), 'nenhum GRANT novo')

if (falhas) { console.error(`\n[check-nfe-vinculo-completa-cest] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfe-vinculo-completa-cest] CEST do produto pela nota ao ligar conferido.')
