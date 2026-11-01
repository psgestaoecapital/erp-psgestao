// Gate (CEO 18/10, sessão interativa) — SORTEIO DE VAGA CIENTE DE OCUPAÇÃO + VAGA DA MAIN SEPARADA.
// Prova, de verdade (rodando os scripts contra um `gh` simulado), os quatro pontos pedidos pelo CEO:
//   (a) com a vaga 0 OCUPADA e a vaga 2 LIVRE, a PR vai para a 2;
//   (b) a vaga 1 NUNCA é sorteada para PR (é reservada para a aceitação da main);
//   (c) a aceitação da main usa SÓ a vaga 1 e o grupo EXISTENTE da vaga 1 (aceitacao-testes-1), com os segredos *_1;
//   (d) se a consulta de ocupação FALHAR, mantém o sorteio antigo (determinístico) sobre as vagas elegíveis.
// E a trava do banco da main (3 travas): allowlist positivo do projeto da vaga 1, anti-produção, Session pooler —
// inclusive o caso do CEO: URL com id diferente de mgyxiamybepkphtfhway → aborta. Sem rede (gh é simulado). Estático.
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const SORT = 'scripts/merge/aceitacao-sortear-vaga.sh'
const GUARDA = 'scripts/merge/aceitacao-main-trava-banco.sh'
const PR = '.github/workflows/aceitacao-pr.yml'
const MAIN = '.github/workflows/aceitacao-main.yml'

// ── Parte 1: fiação nos workflows ────────────────────────────────────────────────────────────────────────────────
const pr = readFileSync(PR, 'utf8')
ok(/scripts\/merge\/aceitacao-sortear-vaga\.sh/.test(pr), 'aceitacao-pr: a triagem chama o sorteio ciente de ocupação')
ok(/ACEITACAO_VAGA_ESCOLHIDA=\$v/.test(pr), 'aceitacao-pr: emite o marcador estável ACEITACAO_VAGA_ESCOLHIDA (lido pelo sorteio)')
ok(!/v=\$\(\( \(\$\{\{ github\.run_number \}\} \+ \$\{\{ github\.run_attempt \}\}\) % vagas \)\)/.test(pr),
  'aceitacao-pr: o sorteio às cegas inline foi removido (agora é o script)')
ok(/group: \$\{\{ vars\.ACEITACAO_BANCO == 'testes' && \(needs\.triagem\.outputs\.vaga == '0' && 'aceitacao-testes'/.test(pr),
  'aceitacao-pr: grupo de concorrência por vaga preservado (o check obrigatório "aceitacao" NÃO foi renomeado)')

const mn = readFileSync(MAIN, 'utf8')
ok(/group: aceitacao-testes-1\b/.test(mn) && !/group: aceitacao-testes(?![-\d])/.test(mn),
  '(c) aceitacao-main: grupo da vaga 1 (aceitacao-testes-1), não mais o grupo da vaga 0 (aceitacao-testes)')
// o grupo é a exclusão mútua do BANCO: a main precisa compartilhar com o montar/reconciliar da vaga 1
const mbt = readFileSync('.github/workflows/montar-banco-testes.yml', 'utf8')
const rec = readFileSync('.github/workflows/reconciliar-vaga.yml', 'utf8')
ok(/format\('aceitacao-testes-\{0\}', inputs\.vaga\)/.test(mbt),
  '(c) montar-banco-testes: vaga N usa o grupo aceitacao-testes-N (a vaga 1 = aceitacao-testes-1, mesma da main)')
ok(/format\('aceitacao-testes-\{0\}', github\.event\.inputs\.vaga\)/.test(rec),
  '(c) reconciliar-vaga: vaga N usa o grupo aceitacao-testes-N (a vaga 1 = aceitacao-testes-1, mesma da main)')
ok(/secrets\.TEST_SUPABASE_URL_1/.test(mn) && /secrets\.TEST_SUPABASE_SERVICE_ROLE_KEY_1/.test(mn) && /secrets\.TEST_DATABASE_URL_1/.test(mn),
  '(c) aceitacao-main: usa os segredos *_1 (vaga 1 de referência)')
ok(!/secrets\.TEST_SUPABASE_URL \}\}/.test(mn) && !/secrets\.TEST_DATABASE_URL \}\}/.test(mn),
  '(c) aceitacao-main: não usa mais os segredos da vaga 0 (sem sufixo)')
ok(/VAGA=1 MAIN_MIGR_DIR=supabase\/migrations scripts\/banco-testes\/reconciliar-vaga\.sh/.test(mn),
  '(c) aceitacao-main: guarda de contaminação na VAGA 1')
ok(/scripts\/merge\/aceitacao-main-trava-banco\.sh/.test(mn) && /ESPERADO: mgyxiamybepkphtfhway/.test(mn),
  '(c) aceitacao-main: trava do banco pela guarda da vaga 1 (allowlist mgyxiamybepkphtfhway)')
// a vaga 1 não aparece como vaga de PR em lugar nenhum do sorteio (é exclusiva da main)
ok(!/elig\+=\(1\)/.test(readFileSync(SORT, 'utf8')) && /é reservada para a (aceitação da )?main/i.test(readFileSync(SORT, 'utf8')),
  '(b) a vaga 1 nunca entra no conjunto elegível do sorteio de PR')

// ── Parte 2: `gh` simulado para rodar o sorteio de verdade ───────────────────────────────────────────────────────
const temBash = (() => { try { execFileSync('bash', ['-c', 'true']); return true } catch { return false } })()
if (!temBash) {
  console.log('… cenários do sorteio pulados: bash ausente (a Parte 1 continua valendo)')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'vaga-gh-'))
  const fakeGh = join(dir, 'gh')
  writeFileSync(fakeGh, `#!/usr/bin/env bash
path=""; jqx=""
while [ $# -gt 0 ]; do
  case "$1" in
    --jq) jqx="$2"; shift 2;;
    repos/*) path="$1"; shift;;
    *) shift;;
  esac
done
[ "\${GH_FAIL:-0}" = 1 ] && exit 1
case "$path" in
  *status=in_progress*) printf '%s\\n' \${GH_INPROGRESS:-}; exit 0;;
  *status=queued*)      printf '%s\\n' \${GH_QUEUED:-};     exit 0;;
  *status=pending*)     printf '%s\\n' \${GH_PENDING:-};    exit 0;;
  */actions/runs/*/jobs)
     rid=$(printf '%s' "$path" | sed -nE 's#.*/actions/runs/([0-9]+)/jobs#\\1#p')
     case "$jqx" in
       *aceitacao*) eval "printf '%s\\n' \\"\\\${GH_ACC_$rid:-}\\""; exit 0;;
       *triagem*)   eval "printf '%s\\n' \\"\\\${GH_TJID_$rid:-}\\""; exit 0;;
     esac; exit 0;;
  */actions/jobs/*/logs)
     tj=$(printf '%s' "$path" | sed -nE 's#.*/actions/jobs/([0-9]+)/logs#\\1#p')
     eval "v=\\\${GH_VAGALOG_$tj:-}"; [ -n "$v" ] && echo "ACEITACAO_VAGA_ESCOLHIDA=$v"; exit 0;;
esac
exit 0
`)
  chmodSync(fakeGh, 0o755)
  const PATHx = `${dir}:${process.env.PATH}`
  const base = { VAGAS: '3', URL1: 'x', URL2: 'x', REPO: 'o/r', GH_TOKEN: 't', SELF_RUN_ID: '999', PATH: PATHx }
  const sortear = (extra: Record<string, string>): string =>
    execFileSync('bash', [SORT], { encoding: 'utf8', env: { ...process.env, ...base, ...extra } }).trim()

  // (a) vaga 0 ocupada (run 111: aceitacao in_progress, triagem 911, log vaga=0) e vaga 2 livre → PR vai para a 2
  ok(sortear({ RUN: '4', GH_INPROGRESS: '111', GH_ACC_111: 'in_progress', GH_TJID_111: '911', GH_VAGALOG_911: '0' }) === '2',
    '(a) vaga 0 ocupada e vaga 2 livre → a PR vai para a vaga 2')
  // simétrico: vaga 2 ocupada e vaga 0 livre → vai para a 0
  ok(sortear({ RUN: '5', GH_INPROGRESS: '111', GH_ACC_111: 'in_progress', GH_TJID_111: '911', GH_VAGALOG_911: '2' }) === '0',
    'vaga 2 ocupada e vaga 0 livre → a PR vai para a vaga 0')
  // empate (ambas livres) → menor número (0), NUNCA 1
  ok(sortear({ RUN: '5', GH_INPROGRESS: '' }) === '0',
    '(b) ambas livres → empate resolve pela menor (0); a vaga 1 nunca é escolhida')
  // job aceitacao COMPLETED não ocupa vaga → conta como livre → 0
  ok(sortear({ RUN: '4', GH_INPROGRESS: '111', GH_ACC_111: 'completed', GH_TJID_111: '911', GH_VAGALOG_911: '0' }) === '0',
    'run com aceitacao já concluída não ocupa vaga (só queued/in_progress/pending/waiting contam)')
  // pending/waiting (esperando o grupo de concorrência) CONTAM como ocupação: vaga 0 com 1 rodando + 2 pending, vaga 2 vazia → 2
  const v0 = { GH_INPROGRESS: '111', GH_ACC_111: 'in_progress', GH_TJID_111: '911', GH_VAGALOG_911: '0',
    GH_PENDING: '112 113', GH_ACC_112: 'pending', GH_TJID_112: '912', GH_VAGALOG_912: '0',
    GH_ACC_113: 'waiting', GH_TJID_113: '913', GH_VAGALOG_913: '0' }
  ok(sortear({ RUN: '4', ...v0 }) === '2', 'vaga 0 com 1 rodando + 2 pending e vaga 2 vazia → a PR vai para a vaga 2')
  // discriminante: vaga 2 com 2 rodando; vaga 0 = 1 rodando + 2 pending (3). Só com os pending contados a 2 (2 < 3) vence
  ok(sortear({ RUN: '4', ...v0, GH_QUEUED: '221 222', GH_ACC_221: 'queued', GH_TJID_221: '921', GH_VAGALOG_921: '2',
    GH_ACC_222: 'in_progress', GH_TJID_222: '922', GH_VAGALOG_922: '2' }) === '2',
    'pending/waiting contam como ocupação (vaga 0 com 3 > vaga 2 com 2 → vaga 2)')
  // (d) consulta de ocupação falha → sorteio antigo determinístico sobre as elegíveis [0,2]: RUN%2
  ok(sortear({ RUN: '4', GH_FAIL: '1' }) === '0' && sortear({ RUN: '5', GH_FAIL: '1' }) === '2',
    '(d) consulta de ocupação falha → mantém o sorteio antigo (RUN % nº de vagas elegíveis) sobre {0,2}')
  // (b)+serial: ACEITACAO_VAGAS=1 → sempre vaga 0 (nunca 1/2), idêntico a antes
  ok(execFileSync('bash', [SORT], { encoding: 'utf8', env: { ...process.env, ...base, VAGAS: '1', RUN: '7', GH_FAIL: '1' } }).trim() === '0',
    'ACEITACAO_VAGAS=1 → sempre vaga 0 (serial, como hoje)')

  // ── Parte 3: trava do banco da main (guarda da vaga 1) ─────────────────────────────────────────────────────────
  const guarda = (url: string, dburl: string, esperado = 'mgyxiamybepkphtfhway'): number => {
    try { execFileSync('bash', [GUARDA], { stdio: 'ignore', env: { ...process.env, URL: url, DBURL: dburl, ESPERADO: esperado } }); return 0 }
    catch { return 1 }
  }
  const ok1 = 'https://mgyxiamybepkphtfhway.supabase.co'
  const db1 = 'postgres://postgres.mgyxiamybepkphtfhway:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
  ok(guarda(ok1, db1) === 0, 'guarda: vaga 1 (id mgyxiamybepkphtfhway, pooler) → ok')
  ok(guarda('https://horsymhsinqcimflrtjo.supabase.co', db1) === 1 &&
     guarda(ok1, 'postgres://postgres.horsymhsinqcimflrtjo:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres') === 1,
    'guarda: id da PRODUÇÃO (horsymhsinqcimflrtjo) em qualquer URL → aborta')
  ok(guarda('https://jvntcgqoeuckljzeojxp.supabase.co', 'postgres://postgres.jvntcgqoeuckljzeojxp:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres') === 1,
    'guarda: URL com id DIFERENTE de mgyxiamybepkphtfhway (ex.: vaga 2) → aborta')
  ok(guarda(ok1, 'postgres://postgres.mgyxiamybepkphtfhway:x@db.mgyxiamybepkphtfhway.supabase.co:5432/postgres') === 1,
    'guarda: DB URL que não é Session pooler → aborta')
  ok(guarda('', db1) === 1 && guarda(ok1, '') === 1, 'guarda: URL/DBURL ausente → aborta')
}

ok(existsSync(SORT) && existsSync(GUARDA), 'scripts de sorteio e de guarda do banco presentes')
if (falhas) { console.error(`\ncheck-aceitacao-vaga-ocupacao: ${falhas} falha(s)`); process.exit(1) }
console.log('\nSorteio ciente de ocupação + vaga da main separada: ok')
