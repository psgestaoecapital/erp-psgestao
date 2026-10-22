// Gate (CEO 10/10, sessão interativa) — POOL de bancos de teste: aceitações em PARALELO (1 banco por vaga) para curar a
// inanição da vaga única. Confere a fiação (grupo de concorrência por vaga, seleção do banco por vaga, montar por banco)
// e PROVA a lógica de sharding/clamp (bash) — inclusive a segurança: nunca dois grupos no MESMO banco.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// ── Parte 1: aceitacao-pr.yml ───────────────────────────────────────────────────────────────────────────────────
const wf = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
ok(/group: \$\{\{ vars\.ACEITACAO_BANCO == 'testes' && \(needs\.triagem\.outputs\.vaga == '0' && 'aceitacao-testes' \|\| format\('aceitacao-testes-\{0\}', needs\.triagem\.outputs\.vaga\)\) \|\| 'demo-e2e' \}\}/.test(wf),
  'concurrency: UM grupo por vaga (aceitacao-testes-<vaga>) no banco de testes → vagas diferentes em paralelo')
ok(/cancel-in-progress: false/.test(wf) && /queue: max/.test(wf) && /timeout-minutes: 40/.test(wf),
  'PRESERVA: cancel-in-progress:false, queue:max e timeout-minutes:40')
// CEO 18/10: o sorteio às cegas (run_number+run_attempt)%N saiu da triagem e virou o sorteio CIENTE DE OCUPAÇÃO em
// scripts/merge/aceitacao-sortear-vaga.sh (vaga de PR com menos runs ativos/na fila; vaga 1 reservada para a main;
// fallback determinístico se a consulta falhar). A lógica/sharding é provada em check-aceitacao-vaga-ocupacao.ts.
ok(/VAGAS: \$\{\{ vars\.ACEITACAO_VAGAS \|\| '1' \}\}/.test(wf) && /scripts\/merge\/aceitacao-sortear-vaga\.sh/.test(wf),
  'triagem: a vaga vem do sorteio ciente de ocupação (aceitacao-sortear-vaga.sh); padrão ACEITACAO_VAGAS=1 = serial')
ok(/- name: Selecionar o banco da vaga/.test(wf) && /1\) URL="\$URL1"; ANON="\$ANON1"; SRK="\$SRK1"; DBURL="\$DBURL1";;/.test(wf),
  'job: passo "Selecionar o banco da vaga" mapeia vaga → segredos do banco certo (inclui a DB URL p/ sincronizar)')
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

// (CEO 18/10) A prova da lógica de sorteio/elegibilidade/fallback migrou para check-aceitacao-vaga-ocupacao.ts, que
// roda o scripts/merge/aceitacao-sortear-vaga.sh contra um `gh` simulado. Este gate cobre só a fiação do pool/montar.

if (falhas) { console.error(`\ncheck-aceitacao-pool: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPool de bancos de aceitação: ok')
