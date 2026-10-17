/**
 * Gate (#3281, etapa 3): aviso quando o relatório em segundo plano termina.
 * - gatilho no banco na troca de status para pronto/erro: sino (erp_notificacao_usuario) para QUEM PEDIU, com link para
 *   Meus relatórios; e-mail só quando fica pronto, pelo provedor atual (fn_enviar_email), idempotente pelo pedido;
 * - o aviso nunca desfaz a geração (bloco de exceção) e grava avisado_em;
 * - o e-mail não leva o arquivo nem link público: só título, validade e o caminho da tela (login);
 * - fn_email_render redefinida com o template novo SEM perder os anteriores.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(process.cwd(), 'supabase', 'migrations')
const arqs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const arq = arqs.find((f) => f.endsWith('_relatorio_aviso_pronto.sql'))
ok(!!arq, 'migration relatorio_aviso_pronto existe')
const sql = (arq ? readFileSync(join(dir, arq), 'utf8') : '').replace(/^\s*--[^\n]*/gm, '')

const fn = /FUNCTION public\.fn_relatorio_pedido_avisar\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? ''
ok(!!fn, 'função do aviso existe')
ok(/NEW\.status NOT IN \('pronto','erro'\) OR OLD\.status IS NOT DISTINCT FROM NEW\.status/.test(fn), 'avisa só na troca para pronto/erro')
ok(/INSERT INTO public\.erp_notificacao_usuario[\s\S]*?NEW\.company_id, NEW\.solicitante/.test(fn), 'sino vai para quem pediu, na empresa do pedido')
ok(/'\/dashboard\/financeiro\/meus-relatorios'/.test(fn), 'sino abre Meus relatórios')
ok(/IF NEW\.status = 'pronto' AND v_email IS NOT NULL THEN\s*PERFORM public\.fn_enviar_email\(v_email, 'relatorio_pronto'/.test(fn), 'e-mail só quando pronto, pelo provedor atual')
ok(/'idempotency_key', NEW\.id::text/.test(fn), 'e-mail idempotente pelo pedido')
ok(!/arquivo_path|createSignedUrl|storage\./.test(fn), 'e-mail/sino não levam o arquivo nem link do storage')
ok(/NEW\.avisado_em := now\(\)/.test(fn), 'grava avisado_em')
ok(/EXCEPTION WHEN OTHERS THEN[\s\S]*?RAISE WARNING/.test(fn), 'falha no aviso não desfaz a geração')
ok(/REVOKE ALL ON FUNCTION public\.fn_relatorio_pedido_avisar\(\) FROM PUBLIC, anon, authenticated/.test(sql), 'função do aviso fechada para anon/authenticated')
ok(/CREATE TRIGGER trg_relatorio_pedido_avisar\s+BEFORE UPDATE OF status ON public\.erp_relatorio_pedido/.test(sql), 'gatilho na troca de status do pedido')
ok(!/\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN|ALTER TABLE)\b/i.test(sql) && !/CREATE OR REPLACE VIEW/i.test(sql), 'sem DELETE/DROP/ALTER e sem view')

// fn_email_render: a ÚLTIMA definição do repo tem o template novo e todos os anteriores
const ultimo = [...arqs].reverse().find((f) => readFileSync(join(dir, f), 'utf8').includes('FUNCTION public.fn_email_render('))
const render = ultimo ? readFileSync(join(dir, ultimo), 'utf8') : ''
for (const t of ['convite', 'reset_senha', 'boas_vindas', 'chamado_resposta', 'chamado_lembrete', 'chamado_resumo', 'revenda_convite_contador', 'contrato_evento', 'relatorio_pronto'])
  ok(new RegExp(`'${t}'`).test(render), `fn_email_render (${ultimo}) tem o template ${t}`)
const ramo = /p_template = 'relatorio_pronto' THEN([\s\S]*?)ELSE\s+RETURN NULL/.exec(render)?.[1] ?? ''
ok(/'&','&amp;'\),'<','&lt;'\),'>','&gt;'\)/.test(ramo), 'título do relatório escapado no HTML')

const tela = readFileSync('src/app/dashboard/financeiro/meus-relatorios/page.tsx', 'utf8')
ok(/avisamos no sino e por e-mail/.test(tela), 'tela diz que o aviso chega no sino e por e-mail')

if (falhas) { console.error(`\n${falhas} falha(s) no gate do aviso de relatório`); process.exit(1) }
console.log('\nAviso de relatório pronto: ok')
