// Gate · ATAK/Frioeste — diagnóstico de chaves e recarga completa (CEO 02/10). Sem rede.
// 1) a migration: diagnóstico só para a equipe PS, resposta exige o token do agente, recarga entregue UMA vez,
//    a chave em uso NÃO muda aqui (só depois que o diagnóstico provar a nova — RD-38);
// 2) o agente 2.1.5: diagnóstico só lê (SELECT), recarga tira a janela de dias, versão batendo no package.json;
// 3) a função nova aberta ao agente está na lista aprovada pelo CEO.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const mig = readFileSync('supabase/migrations/20261002220000_atak_diagnostico.sql', 'utf8')
const semComent = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
ok(/CREATE TABLE IF NOT EXISTS public\.atak_diagnostico/.test(mig) && /REVOKE ALL ON public\.atak_diagnostico FROM PUBLIC, anon, authenticated;/.test(mig)
  && /USING \(public\.is_admin\(\)\)/.test(mig), 'atak_diagnostico: RLS, só equipe PS lê')
ok(/fn_atak_diagnostico_responder[\s\S]*agente_token = p_token AND agente_token IS NOT NULL[\s\S]*token inválido/.test(mig), 'resposta do agente exige o token')
ok(/pg_column_size\(p_resultado\) > 1000000/.test(mig), 'resposta com tamanho limitado')
ok(/fn_atak_diagnostico_solicitar[\s\S]*NOT public\.is_admin\(\)[\s\S]*42501/.test(mig), 'só a equipe PS pede o diagnóstico')
ok(/WITH u AS \(UPDATE atak_fonte_mapa SET recarga_completa = false/.test(mig), 'recarga completa é entregue uma vez e desligada')
ok(/fm\.company_id = v\.company_id/.test(mig), 'config do agente só com os domínios da própria empresa')
ok(!/SET\s+chave_fato_sql/i.test(semComent), 'a chave em uso NÃO muda nesta migration (só depois da prova)')
ok(!/\bDELETE\s+FROM\b/i.test(semComent), 'nada é apagado (RD-30)')
for (const d of ['contabil_dre', 'financeiro_receber', 'compra_gado']) ok(new RegExp(`dominio (=|IN \\()[^\\n]*'${d}'`).test(mig), `candidatas a chave para ${d}`)

const ag = readFileSync('collectors/atak-agente/agent.js', 'utf8')
const pkg = JSON.parse(readFileSync('collectors/atak-agente/package.json', 'utf8')) as { version: string; scripts: { test: string } }
ok(/const VERSAO_AGENTE = '2\.1\.5'/.test(ag) && pkg.version === '2.1.5', 'agente 2.1.5 (código e package.json batem)')
ok(/if \(cfg\.diagnostico_pendente\)/.test(ag) && /fn_atak_diagnostico_responder/.test(ag), 'agente roda o diagnóstico quando pedido e entrega à PS')
ok(/dom\.coluna_watermark && !dom\.recarga_completa/.test(ag), 'recarga completa tira a janela de dias')
const diag = ag.slice(ag.indexOf('function montarSqlDiagnostico'), ag.indexOf('async function rodarDiagnostico'))
ok(diag.length > 0 && !/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|EXEC)\b/.test(diag), 'diagnóstico só lê o ATAK (nenhum comando de escrita)')
ok(/test\/diagnostico\.test\.js/.test(pkg.scripts.test), 'testes do diagnóstico entram no build do .exe')

const anon = readFileSync('scripts/anon-funcoes-aprovadas.ts', 'utf8')
ok(/'fn_atak_diagnostico_responder'/.test(anon) && /ci-allow-anon/.test(mig), 'função do agente na lista aprovada pelo CEO')

if (falhas) { console.error(`\ncheck-atak-diagnostico: ${falhas} falha(s)`); process.exit(1) }
console.log('\nATAK diagnóstico: ok')
