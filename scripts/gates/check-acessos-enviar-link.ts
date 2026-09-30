// Gate (CEO 29/09 · Admin › Acessos · "Enviar link de acesso"). Regra de envio + travas de segurança da rota.
// Roda no build. Sem rede.
import { readFileSync } from 'node:fs'
import { planoDeEnvio, textoUltimoEnvio, ACAO_AUDIT_LINK } from '../../src/lib/acessos/enviarLink'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) regra: nunca entrou → convite; já tem conta e já entrou → criar senha nova; convite pendente → reenvia o convite
const pend = planoDeEnvio({ tipo: 'convite_pendente' })
ok(pend.template === 'convite' && pend.link === 'convite', 'convite pendente (sem conta) → reenvia o convite, mesmo código')
const nunca = planoDeEnvio({ tipo: 'pessoa', jaEntrou: false })
ok(nunca.template === 'convite' && nunca.link === 'recuperacao', 'tem conta e nunca entrou → e-mail de convite com link para criar a senha')
const ja = planoDeEnvio({ tipo: 'pessoa', jaEntrou: true })
ok(ja.template === 'reset_senha' && ja.link === 'recuperacao', 'já entrou (caso Renato, 23/07) → e-mail de criar senha nova')

// 2) "quem e quando" em horário de Brasília
const t = textoUltimoEnvio({ em: '2026-09-29T13:05:00Z', por: 'fulano@psgestao.com' })
ok(t === 'Último envio: 29/09/2026, 10:05 por fulano@psgestao.com' || t === 'Último envio: 29/09/2026 10:05 por fulano@psgestao.com', `último envio em BRT com o autor (${t})`)
ok(textoUltimoEnvio(null) === null && textoUltimoEnvio({ em: 'xx', por: null }) === null, 'sem envio / data inválida ⇒ não mostra nada')

// 3) a rota: permissão ANTES de qualquer envio; pessoa tem de ser da empresa; link de senha nunca volta; tudo auditado
const rota = readFileSync('src/app/api/acessos/enviar-link/route.ts', 'utf8')
const post = rota.slice(rota.indexOf('export async function POST'))
const iPode = post.indexOf('podeGerir(u.token, companyId)')
ok(iPode > 0 && iPode < post.indexOf('generateLink') && iPode < post.indexOf("rpc('fn_enviar_email'") && iPode < post.indexOf(".from('invites').update"),
  'permissão (fn_acessos_pode_gerir com o JWT de quem clicou) vem antes de gerar link, renovar convite ou enviar')
ok(post.indexOf(".from('user_companies')") > 0 && post.indexOf(".from('user_companies')") < post.indexOf('generateLink'), 'a pessoa tem de ser desta empresa antes de gerar o link')
ok(/\.eq\('company_id', companyId\)\.maybeSingle\(\)/.test(post), 'convite tem de ser desta empresa')
const retornoOk = post.slice(post.lastIndexOf('return NextResponse.json({ ok: true'))
ok(!/\blink\b(?!:)/.test(retornoOk.replace(/plano\.link/g, '')) && !retornoOk.includes('action_link'), 'a resposta de sucesso NÃO devolve o link (só vai no e-mail)')
ok(post.includes(`acao: ACAO_AUDIT_LINK`) && ACAO_AUDIT_LINK === 'ACESSO_LINK_ENVIADO' && post.includes('user_email:'), 'registra em audit_log_global quem enviou e quando')

// 4) a tela: botão em cada pessoa e em cada convite pendente, via a rota
const pg = readFileSync('src/app/dashboard/admin/acessos/page.tsx', 'utf8')
ok((pg.match(/data-testid="enviar-link"/g) || []).length === 2, 'botão "Enviar link de acesso" na pessoa e no convite pendente')
ok(pg.includes('fetch("/api/acessos/enviar-link"'), 'a tela chama a rota (a regra fica no servidor)')

if (falhas) { console.error(`\ncheck-acessos-enviar-link: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-acessos-enviar-link: ok')
