/**
 * Gate (#1677 B): a migration da solicitação de compra com alçada é aditiva e mantém as regras do CEO — 3 orçamentos
 * (ou o configurado), anexo obrigatório, aprovador do cadastro (nunca fixo), solicitante não aprova, recusa com motivo,
 * reaprovação se o conteúdo mudar, urgência só para itens liberados.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(process.cwd(), 'supabase', 'migrations')
const arq = readdirSync(dir).find((f) => f.endsWith('_compras_solicitacao_aprovacao.sql'))
ok(!!arq, 'migration compras_solicitacao_aprovacao existe')
const sql = (arq ? readFileSync(join(dir, arq), 'utf8') : '').replace(/--[^\n]*/g, '')

ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /get_user_company_ids/.test(sql) && /REVOKE ALL ON public\.%I FROM anon, public/.test(sql), 'RLS por empresa e sem anon')
ok(/REVOKE INSERT, UPDATE, DELETE ON public\.%I FROM authenticated/.test(sql), 'authenticated só lê (escrita pelas funções)')
ok(/anexo_url\s+text NOT NULL/.test(sql) && /Orçamento sem anexo não vale/.test(sql), 'orçamento exige anexo')
ok(/COALESCE\(cfg\.min_orcamentos, 3\)/.test(sql), 'mínimo de orçamentos vem da configuração (padrão 3)')
ok(/aprovador_principal_id/.test(sql) && /aprovador_substituto_id/.test(sql) && !/'[0-9a-f]{8}-[0-9a-f]{4}-/.test(sql.replace(/gen_random_uuid/g, '')), 'aprovador vem do cadastro (sem id fixo)')
ok(/Quem solicita não aprova a própria compra/.test(sql), 'solicitante não aprova')
ok(/Recusa exige motivo/.test(sql), 'recusa exige motivo')
ok(/reaprovacao_exigida/.test(sql) && /fn_compras_solic_assinatura/.test(sql), 'reaprovação quando o conteúdo muda')
ok(/Urgência só vale quando todos os itens estão liberados/.test(sql), 'urgência só com itens liberados')
ok(/SECURITY DEFINER SET search_path TO 'public'/.test(sql) && !/SECURITY DEFINER(?! SET search_path)/.test(sql), 'funções com search_path fixo')
ok(!/CREATE OR REPLACE (VIEW|FUNCTION public\.(?!fn_compras_(solic_|norm_)))/.test(sql), 'não reescreve view/função existente')
ok(!/\b(TRUNCATE|DROP TABLE|DROP COLUMN|ALTER TABLE public\.erp_compras\b)/i.test(sql), 'sem TRUNCATE/DROP nem alteração em erp_compras')

if (falhas) { console.error(`\n[check-compras-solicitacao-migration] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-compras-solicitacao-migration] migration da solicitação conferida.')
