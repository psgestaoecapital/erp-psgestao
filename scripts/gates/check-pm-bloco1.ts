// Gate · P&M Bloco 1 — Pdois em teste (CEO 02/10). Sem rede. Mantém:
// a) Briefing: campo "Briefing" (descricao) com editor (negrito, listas, links) e "?"; "Objetivo" grande; "Virar job"
//    leva o briefing COMPLETO (e prazo e cliente); Novo Job com o mesmo editor;
// b) clientes = erp_clientes (busca por nome/razão/CNPJ) no Briefing, no Novo Job e no filtro da Pauta; o perfil P&M
//    vem de fn_pm_cliente_garantir (guarda da empresa, mesmo cliente da empresa, nada apagado);
// c) responsáveis = usuários ativos da empresa (fn_usuarios_da_empresa) na Pauta, na edição em massa e na IA do filtro;
// d) Pauta vazia: "Novo job" em destaque + "Os jobs do SIGA ainda não foram trazidos".
import { readFileSync } from 'node:fs'
import { briefingParaJob, linkSeguro, termoBusca } from '../../src/lib/pm/briefing'
import { juntarResponsaveis } from '../../src/lib/pm/pauta'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const ler = (p: string) => readFileSync(p, 'utf8')

const b = briefingParaJob({ objetivo: 'Vender mais', publico_alvo: 'Mães', prazo_desejado: '2026-10-10', referencias: 'https://x.y', descricao: '**Entregáveis:** 1 carrossel' })
ok(b.startsWith('**Objetivo:** Vender mais') && b.includes('**Público-alvo:** Mães') && b.includes('**Prazo desejado:** 10/10/2026') && b.endsWith('**Entregáveis:** 1 carrossel'), 'briefing completo vai para o job')
ok(briefingParaJob({ objetivo: '  ', descricao: null }) === '', 'briefing vazio não inventa texto')
ok(termoBusca('Lorenz, (Madeiras)%*') === 'Lorenz Madeiras', 'busca de cliente sem caracteres que quebram o filtro')
ok(linkSeguro('instagram.com/pdois') === 'https://instagram.com/pdois' && linkSeguro('javascript:alert(1)').startsWith('https://') && linkSeguro('http://a.b') === 'http://a.b', 'link do editor só http(s)')

const br = ler('src/app/dashboard/pm/briefings/page.tsx')
ok(/<BriefingEditor value=\{form\.descricao\}[\s\S]{0,200}ajuda="pm\.briefing\.texto"/.test(br) && /descricao: form\.descricao\.trim\(\) \|\| null/.test(br), 'a) Briefing: campo do texto do briefing gravado em descricao')
ok(/<textarea rows=\{4\}[^>]*value=\{form\.objetivo\}/.test(br), 'a) Objetivo é campo grande')
ok(/descricao: briefingParaJob\(b\) \|\| null/.test(br) && /data_prazo: b\.prazo_desejado/.test(br) && /cliente_id: b\.cliente_id/.test(br), 'a) Virar job leva o briefing completo, o prazo e o cliente')
for (const k of ['pm.briefing.titulo', 'pm.briefing.objetivo', 'pm.briefing.publico', 'pm.briefing.tipo', 'pm.briefing.prazo', 'pm.briefing.referencias']) ok(br.includes(`chave="${k}"`), `a) "?" ${k}`)
ok(/<ClienteBusca empresa=\{empresa\}/.test(br) && !/from\('agency_clientes'\)\.select\('id, nome, nome_fantasia'\)\.eq\('company_id'/.test(br), 'b) Briefing busca o cliente no cadastro (não lista agency_clientes)')
const ed = ler('src/components/pm/BriefingEditor.tsx')
ok(/Bold/.test(ed) && /ListOrdered/.test(ed) && /Link2/.test(ed) && /<AjudaCampo chave=\{ajuda\} \/>/.test(ed), 'editor: negrito, listas, link e "?"')
const pr = ler('src/app/dashboard/producao/page.tsx')
ok(/<BriefingEditor value=\{\(form\.descricao as string\) \?\? ''\}[\s\S]{0,200}ajuda="pm\.job\.briefing"/.test(pr) && /<ClienteBusca empresa=\{sel\} testId="job-cliente"/.test(pr), 'a/b) Novo Job: mesmo editor e cliente do cadastro')
ok(/fn_usuarios_da_empresa/.test(pr) && /ajuda="pm\.job\.responsavel"/.test(pr), 'c) Novo Job: responsável = usuários da empresa, com "?"')
ok(/searchParams\.get\('novo'\) !== 'job'/.test(pr), 'd) /dashboard/producao?novo=job abre o formulário')
const cb = ler('src/components/pm/ClienteBusca.tsx')
ok(/from\("erp_clientes"\)/.test(cb) && /fn_pm_cliente_garantir/.test(cb) && /modo === "filtro"/.test(cb), 'b) busca em erp_clientes; escolher garante o perfil P&M; no filtro não cria nada')

const pa = ler('src/app/dashboard/pm/pauta/page.tsx')
ok(/supabase\.rpc\("fn_usuarios_da_empresa", \{ p_company_id: empresa \}\)/.test(pa) && /setEquipe\(juntarResponsaveis\(/.test(pa), 'c) Pauta: responsáveis = usuários ativos da empresa + equipe com usuário (filtro e edição em massa)')
ok(/<ClienteBusca empresa=\{empresa\} modo="filtro"/.test(pa), 'b) Pauta: filtro de cliente busca no cadastro')
ok(/Os jobs do SIGA ainda não foram trazidos/.test(pa) && /data-testid="pauta-vazia-novo-job"/.test(pa) && /data-testid="pauta-novo-job"/.test(pa), 'd) Pauta vazia: texto do SIGA e "Novo job" em destaque')
const ia = ler('src/app/api/pm/pauta/filtro-ia/route.ts')
ok(/rpc\('fn_usuarios_da_empresa'/.test(ia) && /juntarResponsaveis\(/.test(ia), 'c) filtro por frase (IA) conhece os mesmos responsáveis da Pauta')
ok(/juntarResponsaveis\(/.test(pr), 'c) Novo Job: mesma lista de responsáveis da Pauta')
// veredito em produção 02/10 (#1987): só os usuários da empresa deixava de fora quem já é responsável por jobs sem estar
// no cadastro de acessos (o administrador na demo: 6 jobs que sumiam do filtro)
{
  const r = juntarResponsaveis(
    [{ id: 'u1', full_name: 'Marciana', email: null, is_active: true }, { id: 'u2', full_name: 'Inativo', email: null, is_active: false }, { id: 'u3', full_name: null, email: 'ana@x.com', is_active: true }],
    [{ user_id: 'u9', nome: 'Gilberto' }, { user_id: 'u1', nome: 'Marci (equipe)' }, { user_id: null, nome: '[DEMO] Sem usuário' }])
  ok(JSON.stringify(r) === JSON.stringify([{ id: 'u3', nome: 'ana@x.com' }, { id: 'u9', nome: 'Gilberto' }, { id: 'u1', nome: 'Marciana' }]),
    'c) responsáveis: usuários ativos + equipe com usuário, sem repetir, sem inativos nem equipe sem usuário')
}

const mig = ler('supabase/migrations/20261002250000_pm_bloco1_clientes_erp.sql')
ok(/PERFORM public\.fn__guarda_empresa\(p_company_id\);/.test(mig) && /WHERE id = p_erp_cliente_id AND company_id = p_company_id/.test(mig), 'b) garantir: só a empresa do usuário e cliente da mesma empresa')
ok(/IF v_iguais = 1 THEN/.test(mig) && /erp_cliente_id IS NULL/.test(mig), 'b) liga perfil antigo só quando o nome é único no cadastro')
ok(/REVOKE ALL ON FUNCTION public\.fn_pm_cliente_garantir\(uuid, uuid\) FROM PUBLIC, anon;/.test(mig), 'b) nada aberto a anônimo')
ok(!/\b(DELETE\s+FROM|CREATE TABLE|DROP\s+(TABLE|COLUMN|FUNCTION))\b/i.test(mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')), 'sem tabela nova e nada apagado')
ok(/CREATE TRIGGER trg_agency_job_numero BEFORE INSERT ON public\.agency_jobs/.test(mig) && /pg_advisory_xact_lock\(hashtext\('agency_jobs_numero:'/.test(mig) && /IF NEW\.numero IS NULL OR btrim\(NEW\.numero\) = '' THEN/.test(mig), 'job novo ganha o próximo número da empresa (sem corrida; número do SIGA é mantido)')
for (const k of ['pm.cliente.busca', 'pm.briefing.texto', 'pm.job.briefing', 'pm.job.responsavel', 'pm.pauta.vazia']) ok(mig.includes(`'${k}'`), `"?" ${k} no banco`)

if (falhas) { console.error(`\ncheck-pm-bloco1: ${falhas} falha(s)`); process.exit(1) }
console.log('\nP&M Bloco 1: ok')
