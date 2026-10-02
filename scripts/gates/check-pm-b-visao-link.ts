// Gate · PM-B — link da visão salva da Pauta (CEO 02/10). Sem rede.
// 1) o link aceita só um uuid em ?visao= e monta /dashboard/pm/pauta?visao=<id>;
// 2) a tela abre a visão do link (vale mais que a preferência), avisa quando a visão não é visível para a pessoa,
//    mostra "Copiar link" com o "?" e deixa o gestor compartilhar a visão pessoal;
// 3) a migration da demo só mexe na demo da P&M e entra no reset (RD-69); o "?" do link existe no banco.
import { readFileSync } from 'node:fs'
import { visaoDaUrl, linkVisao } from '../../src/lib/pm/pauta'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const id = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b'
ok(visaoDaUrl(`?visao=${id}`) === id && visaoDaUrl(`?visao=${id.toUpperCase()}&x=1`) === id, 'lê o id da visão do link')
ok(visaoDaUrl('?visao=1;drop') === null && visaoDaUrl('') === null && visaoDaUrl('?visao=') === null, 'ignora qualquer coisa que não seja uuid')
ok(linkVisao('https://erp-psgestao.vercel.app/', id) === `https://erp-psgestao.vercel.app/dashboard/pm/pauta?visao=${id}`, 'monta o link da visão')

const tela = readFileSync('src/app/dashboard/pm/pauta/page.tsx', 'utf8')
ok(/const idLink = visaoDaUrl\(window\.location\.search\)/.test(tela) && /setPrefCarregada\(true\)/.test(tela.slice(tela.indexOf('const idLink'))),
  'link da visão é aplicado antes da primeira carga (vale mais que a preferência)')
ok(/não foi compartilhada com você/.test(tela), 'aviso quando a visão do link não é visível para a pessoa')
ok(/data-testid="pauta-visao-copiar-link"/.test(tela) && /<AjudaCampo chave="pm\.pauta\.visao_link" \/>/.test(tela), '"Copiar link" com o "?"')
ok(/podeGerir && visaoAtual\.dono_id === userId/.test(tela), 'só o gestor dono compartilha a visão pessoal')
ok(/window\.history\.replaceState\(null, "", visao \? `\?visao=\$\{visao\.id\}` : window\.location\.pathname\)/.test(tela), 'endereço acompanha a visão em uso')

const mig = readFileSync('supabase/migrations/20261002240000_pm_b_visoes_demo.sql', 'utf8')
ok(/IF p_company_id IS DISTINCT FROM v_demo\s+OR NOT EXISTS \(SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE\)/.test(mig), 'seed só na demo da P&M')
ok(/fn_demo_seed_pm_visoes\(p_company_id\)/.test(mig) && /IF v_new = v_def THEN RAISE EXCEPTION/.test(mig), 'entra no fn_demo_reset (aborta se a âncora sumir)')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_pm_visoes\(uuid\) FROM PUBLIC, anon, authenticated;/.test(mig), 'seed sem acesso de usuário')
ok(/'pm\.pauta\.visao_link'/.test(mig), '"?" do link no banco')
ok(!/\bDELETE\s+FROM\b/i.test(mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')), 'nada é apagado (RD-30)')

if (falhas) { console.error(`\ncheck-pm-b-visao-link: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPM-B link da visão: ok')
