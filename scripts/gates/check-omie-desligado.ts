// Gate · Omie DESCONECTADO EM DEFINITIVO (CEO 02/10/2026). Sem rede. Mantém:
// 1) o cliente da API (omieCall) e toda rota que chamava o Omie recusam antes de qualquer chamada (410);
// 2) as telas mostram "Desligado em 02/10/2026" e não têm botão de sincronizar (Conectores, Hub, /admin/sync-status);
// 3) a migration: triggers do outbox desligados, pendentes cancelados com motivo, crons inativos, funções travadas,
//    controle de sync recusando "reativar", e as credenciais com as travas do CEO (padrão do nome, exatamente 12,
//    registro sem o valor, total do cofre conferido).
import { readFileSync } from 'node:fs'
import { OMIE_DESLIGADO, OMIE_DESLIGADO_ROTULO } from '../../src/lib/omie/constantes'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const ler = (p: string) => readFileSync(p, 'utf8')

ok(OMIE_DESLIGADO === true && OMIE_DESLIGADO_ROTULO === 'Desligado em 02/10/2026', 'Omie desligado, rótulo "Desligado em 02/10/2026"')

const cli = ler('src/lib/omieClient.ts')
const call = cli.slice(cli.indexOf('export async function omieCall'), cli.indexOf('export async function omieCall') + 400)
ok(/if \(OMIE_DESLIGADO\) throw new Error/.test(call), 'omieCall recusa antes de montar a chamada')

for (const r of ['omie/route.ts', 'omie/sync/route.ts', 'omie/promote/route.ts', 'sync/omie/clientes/route.ts',
  'sync/omie/fornecedores/route.ts', 'sync/omie/full/route.ts', 'sync/omie/produtos/route.ts']) {
  const s = ler(`src/app/api/${r}`)
  ok(/export async function POST\([^)]*\)[^{]*\{\s*\n\s*if \(OMIE_DESLIGADO\) return omieDesligadoResposta\(\)/.test(s), `/api/${r.replace('/route.ts', '')} responde 410 na primeira linha`)
}
// leitura do histórico importado (omie_imports) continua: Análises usa
for (const r of ['omie/detail/route.ts', 'omie/process/route.ts'])
  ok(!/OMIE_DESLIGADO/.test(ler(`src/app/api/${r}`)), `/api/${r.replace('/route.ts', '')} segue lendo o histórico (não chama o Omie)`)
ok(/status: 410/.test(ler('src/lib/omie/desligado.ts')), 'resposta 410 (Gone)')

const con = ler('src/app/dashboard/conectores/page.tsx')
ok(/\{ id: 'omie', [^}]*status: 'desligado'[^}]*campos: \[\] \}/.test(con) && !/syncApi: '\/api\/omie\/sync'/.test(con), 'Conectores: Omie desligado, sem credenciais nem Sincronizar')
const hub = ler('src/app/dashboard/projetos/configuracoes/page.tsx')
ok(!/label="Sincronizar (estoque|contas a pagar) com Omie"/.test(hub) && /hub-omie-desligado/.test(hub), 'Hub: sem "Sincronizar com o Omie", mostra o aviso')
const st = ler('src/app/admin/sync-status/page.tsx')
ok(/\{!OMIE_DESLIGADO && <button\s+onClick=\{\(\) => executarAcao\('sync_agora'/.test(st) && /\{!OMIE_DESLIGADO && <button onClick=\{\(\) => executarAcao\('reativar_todos'\)/.test(st),
  '/admin/sync-status: sem "Sincronizar agora" nem "Reativar todos"')

const mig = ler('supabase/migrations/20261002230000_omie_desligado.sql')
ok(/DISABLE TRIGGER trg_outbox_pagar;/.test(mig) && /DISABLE TRIGGER trg_outbox_receber;/.test(mig), 'outbox: triggers que enfileiram desligados')
ok(/SET status = 'cancelado', erro_mensagem = 'Omie desligado em 02\/10\/2026'/.test(mig), 'outbox: pendentes cancelados com o motivo do CEO')
ok(/cron\.alter_job\(r\.jobid, active := false\)/.test(mig), 'crons do Omie inativos')
for (const f of ['fn_omie_sync_empresa', 'fn_outbox_omie_dispatch', 'fn_sync_empresa', 'fn_sync_orquestrador', 'fn_processar_respostas_sync'])
  ok(mig.includes(`'${f}'`), `função travada: ${f}`)
ok(/IF v_novo = v_def THEN RAISE EXCEPTION/.test(mig), 'patch das funções aborta se a âncora sumir')
ok(/IF p_acao IN \('sync_agora', 'reativar_todos'\) THEN\s+--[^\n]*\n\s+RETURN jsonb_build_object\('erro', 'Omie desligado em 02\/10\/2026'/.test(mig), 'controle de sync recusa sincronizar/reativar')
// travas das credenciais (CEO)
ok(mig.includes("'^omie_app_(key|secret)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'") && /right\(e\.nome_secret_vault, 36\) = e\.company_id::text/.test(mig),
  '(a) só segredos do Omie, pelo padrão do nome, da própria empresa')
ok(/array_length\(v_nomes, 1\), 0\) <> 12 OR v_empresas <> 6 OR v_no_cofre <> 12 THEN\s+RAISE EXCEPTION/.test(mig), '(b) aborta se não forem exatamente 12 (6 empresas)')
const reg = mig.slice(mig.indexOf('INSERT INTO public.audit_log_global'), mig.indexOf('DELETE FROM vault.secrets'))
ok(/'nome', s\.name/.test(reg) && /'empresa', co\.nome_fantasia/.test(reg) && /'removido_em', now\(\)/.test(reg) && !/decrypted_secret|s\.secret\b/.test(reg),
  '(c) registra nome, empresa e data — nunca o valor')
ok(!/decrypted_secret/.test(mig), 'migration nunca lê o valor de segredo')
ok(/v_apagados <> 12 OR v_total_antes - v_total_depois <> 12 THEN\s+RAISE EXCEPTION/.test(mig), '(d) total do cofre cai exatamente 12 (as demais intactas)')
const semComent = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
ok((semComent.match(/\bDELETE\s+FROM\b/gi) ?? []).length === 1 && /DELETE FROM vault\.secrets s WHERE s\.name = ANY\(v_nomes\) AND s\.name ~ c_padrao;/.test(semComent),
  'único DELETE é o dos 12 segredos aprovados pelo CEO (nada de dado de negócio)')

if (falhas) { console.error(`\ncheck-omie-desligado: ${falhas} falha(s)`); process.exit(1) }
console.log('\nOmie desligado: ok')
