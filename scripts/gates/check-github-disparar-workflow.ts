// Gate (Eng. Chefe 17/10, 434d0e6e) — disparo de workflow do GitHub pelo banco. Confere na migration: lista fechada, chave só
// dentro da função (nunca no log/retorno), execução só da conexão de serviço, log, validade da chave e ações do vigia.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261017230035_github_disparar_workflow.sql', 'utf8')
const fnDisparar = mig.match(/FUNCTION public\.fn_github_disparar_workflow\([\s\S]*?\$fn\$;/)?.[0] ?? ''

ok(/CREATE TABLE IF NOT EXISTS public\.erp_github_workflow_permitido/.test(mig) && /ENABLE ROW LEVEL SECURITY/.test(mig)
  && (mig.match(/REVOKE ALL ON public\.erp_github_\w+\s+FROM PUBLIC, anon, authenticated/g) ?? []).length >= 3,
  'migration: lista fechada + RLS ligada + REVOKE anon/authenticated nas 3 tabelas')
ok(/'vaga_suja'/.test(mig) && /"vaga":\{"enum":\["0","1"\]\}/.test(mig), 'migration: vaga só 0 ou 1 e ação do vigia "vaga suja"')
ok(/situacao_vigia[\s\S]*aceitacao_abortada_infra/.test(mig), 'migration: ação do vigia "aceitação abortada por infra → re-rodar"')
ok(/SECURITY DEFINER/.test(fnDisparar) && /auth\.uid\(\) IS NOT NULL/.test(fnDisparar), 'disparo: SECURITY DEFINER e recusa sessão de usuário')
ok(/FROM public\.erp_github_workflow_permitido WHERE workflow = p_workflow AND ativo/.test(fnDisparar)
  && /workflow fora da lista permitida/.test(fnDisparar), 'disparo: workflow fora da lista é recusado com motivo')
ok(/decrypted_secret INTO v_token FROM vault\.decrypted_secrets WHERE name = 'github_actions_dispatch_token'/.test(fnDisparar),
  'disparo: lê a chave do cofre só dentro da função')
const retornos = [...fnDisparar.matchAll(/RETURN jsonb_build_object\([^;]*\);/g)].map(m => m[0]).join('\n')
const inserts = [...fnDisparar.matchAll(/INSERT INTO public\.erp_github_disparo_log[\s\S]*?;/g)].map(m => m[0]).join('\n')
ok(!/v_token/.test(retornos) && !/v_token/.test(inserts) && !/RAISE[^;]*v_token/.test(fnDisparar), 'disparo: a chave nunca vai a retorno, log nem RAISE')
ok(/https:\/\/api\.github\.com\/repos\/psgestaoecapital\/erp-psgestao\/actions\/workflows\/' \|\| p_workflow \|\| '\/dispatches/.test(fnDisparar)
  && /net\.http_post/.test(fnDisparar), 'disparo: POST no endpoint de dispatch do repo via pg_net')
ok(/REVOKE ALL ON FUNCTION public\.fn_github_disparar_workflow\(text, text, jsonb, text\) FROM PUBLIC, anon, authenticated/.test(mig)
  && /GRANT EXECUTE ON FUNCTION public\.fn_github_disparar_workflow\(text, text, jsonb, text\) TO service_role/.test(mig),
  'disparo: execução só service_role (REVOKE PUBLIC/anon/authenticated)')
ok(/github-authentication-token-expiration/.test(mig) && /erp_github_token_validade/.test(mig), 'validade: lê o cabeçalho de expiração e grava')
ok(/interval '15 days'/.test(mig) && /interval '365 days'/.test(mig) && /cron\.schedule\('github-token-vigia'/.test(mig),
  'validade: aviso ao CEO 15 dias antes (e revisão anual sem expiração), com agenda')
ok(/cron\.schedule\('github-disparo-coletar'/.test(mig), 'log: coletor agendado (status HTTP e id da execução)')
ok(/erp_esteira_vigia_acao/.test(mig) && /interval '30 minutes'/.test(mig), 'vigia: registra a ação e limita a 1 por janela de 30 min')
ok(/^name: Dispatch ping/m.test(readFileSync('.github/workflows/dispatch-ping.yml', 'utf8')) && /dispatch-ping\.yml/.test(mig),
  'workflow inofensivo dispatch-ping.yml existe e está na lista')
ok(/recriar via fn_github|vaga suja/i.test(readFileSync('docs/esteira/manual-vigia-infra.md', 'utf8')), 'manual do vigia documentado')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-github-disparar-workflow: OK')
