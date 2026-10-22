/**
 * Gate (#1677 A): a migration da configuração da alçada é aditiva e segura (RLS por empresa, REVOKE anon, escrita só
 * pela função com guarda Master, trilha de alterações, sem reescrever objeto existente).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(process.cwd(), 'supabase', 'migrations')
const arq = readdirSync(dir).find((f) => f.endsWith('_compras_alcada_config.sql'))
ok(!!arq, 'migration compras_alcada_config existe')
const sql = (arq ? readFileSync(join(dir, arq), 'utf8') : '').replace(/--[^\n]*/g, '')

ok(/min_orcamentos\s+smallint NOT NULL DEFAULT 3 CHECK \(min_orcamentos IN \(1, 3\)\)/.test(sql), 'orçamentos: padrão 3, só 1 ou 3')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /get_user_company_ids/.test(sql), 'RLS por empresa')
ok(/REVOKE ALL ON public\.erp_compras_alcada_config, public\.erp_compras_alcada_historico FROM anon, public/.test(sql), 'sem acesso anon')
ok(/REVOKE INSERT, UPDATE, DELETE ON public\.erp_compras_alcada_config[^;]*FROM authenticated/.test(sql), 'authenticated só lê (escrita pela função)')
ok(/fn_compras_alcada_usuario_master\(p_company_id\)/.test(sql) && /'socio'.*'acesso_total'.*'admin'.*'adm'/.test(sql) && /CLIENT_OWNER/.test(sql), 'guarda de papel Master no salvar')
ok(/SECURITY DEFINER SET search_path TO 'public'/.test(sql), 'funções com search_path fixo')
ok(/INSERT INTO public\.erp_compras_alcada_historico/.test(sql), 'trilha de alterações da configuração')
ok(/ADD COLUMN IF NOT EXISTS aprovado_por[\s\S]*aprovado_em[\s\S]*aprovacao_motivo/.test(sql), 'registro aprovado_por/em/motivo na compra (aditivo)')
ok(!/CREATE OR REPLACE (VIEW|FUNCTION public\.(?!fn_compras_alcada_))/.test(sql), 'não reescreve view/função existente')
ok(!/\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN|UPDATE public\.erp_compras\b)/i.test(sql), 'sem DELETE/TRUNCATE/DROP/UPDATE em dado')

if (falhas) { console.error(`\n[check-compras-alcada-migration] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-compras-alcada-migration] migration da alçada conferida.')
