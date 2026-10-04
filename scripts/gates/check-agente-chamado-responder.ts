/**
 * Gate de build (CEO 04/10 · opção A): o agente responde chamado por UMA função oficial, e o e-mail do chamado tem template.
 *   1) fn_agente_chamado_responder: só conexão de serviço (guarda do canal), só com OK do CEO na caixa, texto com hash,
 *      autor = CEO (PS_ADMIN/PS_ADMIN_CVM), rastro aditivo, notificação do caminho normal (tipo 'resposta' → e-mail), revogada
 *      de PUBLIC/anon/authenticated, e NUNCA forja claims de JWT;
 *   2) o AGENTS.md proíbe forjar identidade e manda responder chamado só por essa função;
 *   3) a ÚLTIMA definição de fn_email_render no repo tem TODOS os templates que algum fn_enviar_email usa (cada migration que
 *      redefinia a função apagava o ramo da anterior: "template desconhecido: chamado_resposta").
 *   npm run gates -- agente-chamado-responder
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const raiz = join(__dirname, '../..')
const dir = join(raiz, 'supabase/migrations')
const arqs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const le = (f: string) => readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, '')

// 1) função oficial
const arq = [...arqs].reverse().find((f) => le(f).includes('FUNCTION public.fn_agente_chamado_responder('))
ok(!!arq, `migration da função encontrada (${arq ?? '—'})`)
const sql = arq ? le(arq) : ''
const ini = sql.indexOf('FUNCTION public.fn_agente_chamado_responder(')
const corpo = sql.slice(ini, sql.indexOf('$function$;', sql.indexOf('$function$', ini) + 10))
ok(corpo.includes('fn__agente_assert_servico()'), 'passa pela guarda do canal (só conexão de serviço)')
ok(/requer_ok_ceo OR m\.ok_ceo_em IS NULL/.test(corpo) && corpo.includes("'sem_ok_do_ceo'"), 'só posta com OK do CEO registrado na caixa')
ok(corpo.includes('sha256(') && corpo.includes('texto_hash'), 'registra o hash do texto aprovado')
ok(/system_role IN \('PS_ADMIN','PS_ADMIN_CVM'\)/.test(corpo) && corpo.includes("'ceo_nao_identificado'"), 'autor é o CEO (usuário PS_ADMIN de verdade)')
ok(!/p_ceo_user/.test(sql) && corpo.includes('erp_agente_config'), 'autor vem da configuração única, não de parâmetro do chamador')
ok(/ok_ceo_origem/.test(corpo) && /ok_registrado_por/.test(corpo), 'rastro registra ok_ceo_origem e ok_registrado_por')
ok(corpo.includes("'texto_diferente_do_aprovado'"), 'texto postado tem de bater com o hash aprovado')
ok(/redigido_por/.test(corpo) && /aprovado_por/.test(corpo) && /mensagem_agente_id/.test(corpo) && /ok_ceo_em/.test(corpo), 'rastro: redigido_por, aprovado_por, ok_ceo_em, mensagem_agente_id')
ok(/INSERT INTO sugestao_notificacao[^;]*'resposta'[^;]*'pendente'/.test(corpo), "notificação do caminho normal (tipo 'resposta', e-mail pendente)")
ok(!/set_config|request\.jwt|auth\.uid\(\)\s*:=/i.test(corpo), 'não forja claims de JWT nem identidade')
ok(!/DELETE\s+FROM/i.test(corpo), 'nada é apagado')
ok(sql.includes('REVOKE ALL ON FUNCTION public.fn_agente_chamado_responder(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;'), 'revogada de PUBLIC/anon/authenticated')

// 2) AGENTS.md
const agents = readFileSync(join(raiz, 'AGENTS.md'), 'utf8')
ok(/nunca forja identidade/i.test(agents) && agents.includes('fn_agente_chamado_responder'), 'AGENTS.md: agente nunca forja identidade; responde chamado só por fn_agente_chamado_responder')

// 3) templates de e-mail
const usados = new Set<string>()
for (const f of arqs) for (const m of le(f).matchAll(/fn_enviar_email\([^;]*?'([a-z_]+)'\s*,\s*jsonb_build_object/g)) usados.add(m[1])
const ultimoRender = [...arqs].reverse().find((f) => le(f).includes('FUNCTION public.fn_email_render('))
ok(!!ultimoRender, `última definição de fn_email_render (${ultimoRender ?? '—'})`)
const render = ultimoRender ? le(ultimoRender) : ''
for (const t of usados) ok(new RegExp(`'${t}'`).test(render), `fn_email_render (última definição) tem o template ${t}`)
for (const t of ['convite', 'reset_senha', 'boas_vindas', 'chamado_resposta', 'chamado_lembrete', 'revenda_convite_contador', 'contrato_evento'])
  ok(new RegExp(`'${t}'`).test(render), `template ${t} presente`)

if (falhas) { console.error(`\ncheck-agente-chamado-responder: ${falhas} falha(s)`); process.exit(1) }
console.log('\nAgente responde chamado + templates de e-mail: ok')
