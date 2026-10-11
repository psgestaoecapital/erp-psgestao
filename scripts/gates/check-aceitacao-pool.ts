// Gate (CEO 10/10, sessão interativa) — POOL de bancos de teste: aceitações em PARALELO (1 banco por vaga) para curar a
// inanição da vaga única. Confere a fiação (grupo de concorrência por vaga, seleção do banco por vaga, montar por banco)
// e PROVA a lógica de sharding/clamp (bash) — inclusive a segurança: nunca dois grupos no MESMO banco.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// ── Parte 1: aceitacao-pr.yml ───────────────────────────────────────────────────────────────────────────────────
const wf = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
ok(/group: \$\{\{ vars\.ACEITACAO_BANCO == 'testes' && format\('aceitacao-testes-\{0\}', needs\.triagem\.outputs\.vaga\) \|\| 'demo-e2e' \}\}/.test(wf),
  'concurrency: UM grupo por vaga (aceitacao-testes-<vaga>) no banco de testes → vagas diferentes em paralelo')
ok(/cancel-in-progress: false/.test(wf) && /queue: max/.test(wf) && /timeout-minutes: 40/.test(wf),
  'PRESERVA: cancel-in-progress:false, queue:max e timeout-minutes:40')
ok(/VAGAS: \$\{\{ vars\.ACEITACAO_VAGAS \|\| '1' \}\}/.test(wf) && /v=\$\(\( \$\{\{ github\.run_number \}\} % vagas \)\)/.test(wf),
  'triagem: vaga = run_number % ACEITACAO_VAGAS (padrão 1 = serial, como hoje)')
ok(/case "\$v" in 1\) \[ -n "\$URL1" \] \|\| v=0;; 2\) \[ -n "\$URL2" \] \|\| v=0;; esac/.test(wf),
  'triagem: vaga > 0 só quando o banco dela está provisionado (senão cai p/ 0 — nunca 2 grupos no mesmo banco)')
ok(/- name: Selecionar o banco da vaga/.test(wf) && /1\) URL="\$URL1"; ANON="\$ANON1"; SRK="\$SRK1";;/.test(wf),
  'job: passo "Selecionar o banco da vaga" mapeia vaga → segredos do banco certo')
// os passos de teste não fixam mais TEST_SUPABASE_* por expressão — vêm do GITHUB_ENV do passo de seleção
ok(!/SUPABASE_URL: \$\{\{ vars\.ACEITACAO_BANCO == 'testes' && secrets\.TEST_SUPABASE_URL/.test(wf),
  'passos de teste usam o banco selecionado (GITHUB_ENV), não mais a expressão fixa TEST_SUPABASE_*')

// ── Parte 2: montar-banco-testes.yml ────────────────────────────────────────────────────────────────────────────
const mb = readFileSync('.github/workflows/montar-banco-testes.yml', 'utf8')
ok(/vaga:\s*\n\s*description:.*pool/i.test(mb) && /- name: Selecionar o banco da vaga/.test(mb),
  'montar: input "vaga" + seleção do banco por vaga')
ok(/horsymhsinqcimflrtjo\*\) echo "::error::TEST_DATABASE_URL aponta para a PRODUÇÃO/.test(mb),
  'montar: a trava NUNCA deixa apontar para a produção (preservada)')
ok(/ACEITACAO_VAGA:-0.*= 0/.test(mb) || /if \[ "\$\{ACEITACAO_VAGA:-0\}" = 0 \]/.test(mb),
  'montar: vaga 0 confirma o projeto de testes atual; vaga > 0 exige pooler não-produção')

// ── Parte 3: PROVA da lógica de sharding/clamp (bash) ───────────────────────────────────────────────────────────
const shard = (vagas: string, run: number, url1: string, url2: string): string =>
  execFileSync('bash', ['-c', `
    vagas="$VAGAS"; case "$vagas" in ''|*[!0-9]*) vagas=1;; esac; [ "$vagas" -ge 1 ] || vagas=1
    v=$(( RUN % vagas ))
    case "$v" in 1) [ -n "$URL1" ] || v=0;; 2) [ -n "$URL2" ] || v=0;; esac
    echo "$v"`, '--'],
    { encoding: 'utf8', env: { ...process.env, VAGAS: vagas, RUN: String(run), URL1: url1, URL2: url2 } }).trim()

ok(shard('1', 5, '', '') === '0' && shard('1', 4, 'x', 'x') === '0', 'sharding: ACEITACAO_VAGAS=1 → sempre vaga 0 (serial, como hoje)')
ok(shard('2', 5, 'x', '') === '1' && shard('2', 4, 'x', '') === '0', 'sharding: VAGAS=2 (banco 1 provisionado) → run_number distribui 0/1')
ok(shard('2', 5, '', '') === '0', 'segurança: VAGAS=2 mas banco 1 NÃO provisionado → vaga 0 (nunca 2 grupos no mesmo banco)')
ok(shard('3', 5, 'x', 'x') === '2' && shard('3', 3, 'x', 'x') === '0', 'sharding: VAGAS=3 (bancos 1 e 2) → 0/1/2')
ok(shard('abc', 7, 'x', 'x') === '0', 'sharding: ACEITACAO_VAGAS inválido → 1 vaga (serial), nunca quebra')

if (falhas) { console.error(`\ncheck-aceitacao-pool: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPool de bancos de aceitação: ok')
