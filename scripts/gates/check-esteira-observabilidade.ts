// Gate (CEO 10/10, sessão interativa) — BASE da observabilidade da esteira. Confere:
//  (1) a migration cria erp_esteira_pr_estado + erp_esteira_vigia_acao com RLS/REVOKE e os RPCs writer/reader;
//  (2) a fila-merge.sh captura os motivos e grava o snapshot no trap EXIT (guardado nos segredos), e a fila-merge.yml
//      passa SUPABASE_URL/SERVICE_KEY;
//  (3) o parser esteira-estado-json.py transforma as linhas "#<pr> ..." da fila no payload correto (motivo bate com o
//      log — RD-38), derivando estado/via/tem_migration.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: migration ───────────────────────────────────────────────────────────────────────────────────────────
const mig = readFileSync('supabase/migrations/20261010180030_esteira_observabilidade_base.sql', 'utf8')
ok(/CREATE TABLE IF NOT EXISTS public\.erp_esteira_pr_estado/.test(mig) && /pr_numero\s+integer PRIMARY KEY/.test(mig),
  'migration: tabela erp_esteira_pr_estado (PK pr_numero)')
ok(/CREATE TABLE IF NOT EXISTS public\.erp_esteira_vigia_acao/.test(mig), 'migration: tabela erp_esteira_vigia_acao (log do vigia)')
ok((mig.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length >= 2
  && (mig.match(/REVOKE ALL ON public\.erp_esteira_\w+ FROM PUBLIC, anon, authenticated/g) ?? []).length >= 2,
  'migration: RLS ligada e REVOKE anon/authenticated nas duas tabelas (RD-79)')
ok(/CREATE POLICY erp_esteira_pr_estado_sel_ps[\s\S]*?fn_dev_painel_pode_ver\(\)/.test(mig),
  'migration: SELECT só da equipe PS (fn_dev_painel_pode_ver)')
ok(/FUNCTION public\.fn_esteira_pr_estado_gravar\(text, jsonb\)[\s\S]*?SECURITY DEFINER/.test(mig)
  && /GRANT EXECUTE ON FUNCTION public\.fn_esteira_pr_estado_gravar\(text, jsonb\) TO service_role/.test(mig)
  && /REVOKE ALL ON FUNCTION public\.fn_esteira_pr_estado_gravar\(text, jsonb\) FROM PUBLIC, anon, authenticated/.test(mig),
  'migration: writer fn_esteira_pr_estado_gravar SECURITY DEFINER, só service_role')
ok(/DELETE FROM public\.erp_esteira_pr_estado WHERE pr_numero <> ALL \(v_prs\)/.test(mig),
  'migration: o writer REMOVE as PRs que saíram do snapshot (não acumula lixo)')
ok(/FUNCTION public\.fn_esteira_pr_estado_listar\(\)[\s\S]*?fn_dev_painel_pode_ver\(\)[\s\S]*?por_motivo/.test(mig)
  && /GRANT EXECUTE ON FUNCTION public\.fn_esteira_pr_estado_listar\(\) TO authenticated, service_role/.test(mig),
  'migration: reader fn_esteira_pr_estado_listar agrupa por motivo, gated na equipe PS')

// ── Parte 2: fila-merge.sh + fila-merge.yml ──────────────────────────────────────────────────────────────────────
const sh = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
ok(/case "\$\*" in \\#\[0-9\]\*\)[\s\S]*?\$TMPF\/estado/.test(sh), 'fila: log() captura as linhas "#<pr> ..." no snapshot')
ok(/flush_estado\(\) \{/.test(sh) && /fn_esteira_pr_estado_gravar/.test(sh)
  && /\[ -n "\$\{SUPABASE_URL:-\}" \] && \[ -n "\$\{SUPABASE_SERVICE_ROLE_KEY:-\}" \] \|\| return 0/.test(sh),
  'fila: flush_estado grava via RPC, guardado nos segredos (no-op sem eles)')
ok(/trap 'flush_estado; rm -rf "\$TMPF"' EXIT/.test(sh), 'fila: o trap EXIT roda flush_estado (grava mesmo quando a rodada encerra em exit 0)')
const wf = readFileSync('.github/workflows/fila-merge.yml', 'utf8')
ok(/SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/.test(wf) && /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/.test(wf),
  'workflow: a fila recebe SUPABASE_URL/SERVICE_KEY (produção) para gravar o snapshot')

// ── Parte 3: parser esteira-estado-json.py com um log real da fila ───────────────────────────────────────────────
const raiz = mkdtempSync(join(tmpdir(), 'esteira-obs-'))
try {
  const fx = join(raiz, 'estado')
  writeFileSync(fx, [
    '#2282 segue a via rápida (checks + preview; aceitação informativa)',
    '#2282 (com migration) aguardando a main: @pos-migration da main em andamento (329) — PRs sem migration podem seguir',
    '#2331 segue a via revisada (aceitação verde + MERGE AUTORIZADO)',
    '#2331 aguardando: checks rodando: aceitacao — segue para a próxima',
    '#2235 fora desta rodada: check vermelho: check_fn_guards (commit 36518be)',
    '#2372 MERGEADA (via rápida)',
    '#430 tem a label nao-publicar: pulada',
  ].join('\n') + '\n')
  const out = execFileSync('python3', ['scripts/merge/esteira-estado-json.py'], {
    encoding: 'utf8', env: { ...process.env, ESTADO_FILE: fx, RUN_URL: 'http://run/1' },
  })
  const payload = JSON.parse(out)
  const by: Record<string, { via: string | null; estado: string; motivo: string; tem_migration: boolean }> =
    Object.fromEntries(payload.p_estados.map((e: { pr: string }) => [e.pr, e]))
  ok(payload.p_run_url === 'http://run/1' && payload.p_estados.length === 5, 'parser: run_url + 5 PRs no snapshot')
  ok(by['2282'].via === 'rapida' && by['2282'].tem_migration === true && by['2282'].estado === 'esperando'
    && /aguardando a main/.test(by['2282'].motivo), 'parser: #2282 via rápida + migration + esperando (motivo bate com o log)')
  ok(by['2331'].via === 'revisada' && by['2331'].estado === 'esperando' && /checks rodando: aceitacao/.test(by['2331'].motivo),
    'parser: #2331 revisada, esperando a aceitação (motivo real)')
  ok(by['2235'].estado === 'fora-da-rodada' && /check vermelho: check_fn_guards/.test(by['2235'].motivo), 'parser: #2235 fora-da-rodada (check vermelho)')
  ok(by['2372'].estado === 'mergeada', 'parser: #2372 mergeada')
  ok(by['430'].estado === 'fora' && /nao-publicar/.test(by['430'].motivo), 'parser: #430 fora (nao-publicar)')
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

if (falhas) { console.error(`\ncheck-esteira-observabilidade: ${falhas} falha(s)`); process.exit(1) }
console.log('\nEsteira observabilidade (base): ok')
