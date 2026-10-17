/**
 * Gate (#3281, etapa 1): a fila de relatórios em segundo plano é aditiva e segura — RLS por empresa E solicitante,
 * sem anon, escrita só por RPC com guarda, gerador só para service_role, período limitado, limite de pedidos abertos,
 * validade de 7 dias, e a tela "Meus relatórios" usa as RPCs com "?" (RD-95) e aparece no menu.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(process.cwd(), 'supabase', 'migrations')
const arq = readdirSync(dir).find((f) => f.endsWith('_relatorio_pedido_fila.sql'))
ok(!!arq, 'migration relatorio_pedido_fila existe')
const sql = (arq ? readFileSync(join(dir, arq), 'utf8') : '').replace(/--[^\n]*/g, '')

ok(/CREATE TABLE IF NOT EXISTS public\.erp_relatorio_pedido/.test(sql), 'tabela nova erp_relatorio_pedido')
ok(/erp_relatorio_pedido ENABLE ROW LEVEL SECURITY/.test(sql), 'RLS ligada')
ok(/solicitante = auth\.uid\(\) AND company_id IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sql), 'cada um vê só os próprios pedidos da empresa a que tem acesso')
ok(/REVOKE ALL ON public\.erp_relatorio_pedido FROM anon, PUBLIC/.test(sql), 'sem acesso anon')
ok(/REVOKE INSERT, UPDATE, DELETE ON public\.erp_relatorio_pedido FROM authenticated/.test(sql), 'authenticated só lê (escrita pela RPC)')
ok(/fn_relatorio_pedir[\s\S]*?get_user_company_ids\(\)\) OR is_admin\(\)\) THEN RETURN jsonb_build_object\('ok',false,'erro','sem_acesso'\)/.test(sql), 'pedir: guarda de empresa')
ok(/interval '36 months'/.test(sql) && /v_fim < v_ini/.test(sql), 'pedir: período válido e no máximo 36 meses')
ok(/v_abertos >= 5/.test(sql), 'pedir: limite de 5 pedidos abertos por pessoa')
ok(/WHERE id = p_id AND solicitante = auth\.uid\(\) AND status = 'na_fila'/.test(sql), 'cancelar: só o próprio e só na fila')
ok(/FOR UPDATE SKIP LOCKED/.test(sql), 'gerador: dois workers nunca pegam o mesmo pedido')
ok(/REVOKE ALL ON FUNCTION public\.fn_relatorio_fila_pegar\(\) FROM anon, PUBLIC, authenticated/.test(sql)
  && /REVOKE ALL ON FUNCTION public\.fn_relatorio_fila_atualizar\([^)]*\) FROM anon, PUBLIC, authenticated/.test(sql), 'gerador: só service_role')
ok(/now\(\) \+ interval '7 days'/.test(sql), 'arquivo pronto vale 7 dias')
ok(/SECURITY DEFINER SET search_path = public/.test(sql), 'funções com search_path fixo')
ok(!/CREATE OR REPLACE (VIEW|FUNCTION public\.(?!fn_relatorio_))/.test(sql), 'não reescreve view/função existente')
ok(!/\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN|ALTER TABLE public\.(?!erp_relatorio_pedido))/i.test(sql), 'sem DELETE/TRUNCATE/DROP e sem alterar tabela existente')
ok(/'financeiro_meus_relatorios'[\s\S]*'\/dashboard\/financeiro\/meus-relatorios'/.test(sql) && /INSERT INTO public\.system_screens/.test(sql), 'tela no menu e em system_screens')

const tela = 'src/app/dashboard/financeiro/meus-relatorios/page.tsx'
const tsx = existsSync(tela) ? readFileSync(tela, 'utf8') : ''
ok(!!tsx, 'tela Meus relatórios existe')
for (const rpc of ['fn_relatorio_pedir', 'fn_relatorio_meus', 'fn_relatorio_cancelar']) ok(tsx.includes(`'${rpc}'`), `tela chama ${rpc}`)
const chavesTela = [...tsx.matchAll(/<AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
const chavesBanco = new Set([...sql.matchAll(/\('(financeiro\.meus_relatorios\.[a-z_]+)'/g)].map((m) => m[1]))
ok(chavesTela.length >= 8, `tela tem "?" nos campos e ações (${chavesTela.length})`)
const semChave = chavesTela.filter((c) => !chavesBanco.has(c))
ok(semChave.length === 0, `toda chave de ajuda da tela existe na migration${semChave.length ? ': faltam ' + semChave.join(', ') : ''}`)

if (falhas) { console.error(`\n[check-relatorio-segundo-plano] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-relatorio-segundo-plano] fila de relatórios em segundo plano conferida.')
