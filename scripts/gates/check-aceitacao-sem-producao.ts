// Gate (CEO/Eng. Chefe 18/10) — a aceitação de PR SÓ roda em banco de TESTES. O fallback de PRODUÇÃO (PURL/PSRK quando
// ACEITACAO_BANCO != 'testes') foi REMOVIDO do aceitacao-pr.yml: se não for 'testes', o job ABORTA com erro claro, nunca
// roda o código da PR contra a produção, e nenhum segredo de produção é referenciado nem gravado em $GITHUB_ENV.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const pr = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')

// Recorta UM job pelo recuo de 2 espaços ("  nome:" até o próximo "  outro:"); comentários "  #" não casam.
const job = (nome: string): string => {
  const i = pr.search(new RegExp(`^  ${nome}:\\s*$`, 'm'))
  if (i < 0) return ''
  const rel = pr.slice(i + 1).search(/^  [A-Za-z0-9_-]+:\s*$/m)
  return pr.slice(i, rel < 0 ? pr.length : i + 1 + rel)
}

// O FOCO deste gate: o job que faz checkout e RODA O CÓDIGO DA PR (aceitacao) não pode ver segredo de PRODUÇÃO. Os jobs
// `triagem` (checkout `ref: main`, código CONFIÁVEL — reserva a vaga) e `liberar-reserva` (sem checkout) usam a chave de
// produção só para a reserva de vaga (#2855); isso é responsabilidade do check-esteira-reserva-vaga.ts (nenhum job com
// checkout DA PR recebe a chave), não deste gate. Por isso a proibição é escopada ao job `aceitacao`, não ao arquivo todo.
const acc = job('aceitacao')
ok(acc !== '', 'o job `aceitacao` (que roda o código da PR) foi encontrado no workflow')
ok(!/secrets\.SUPABASE_URL\b/.test(acc), 'o job aceitação não referencia secrets.SUPABASE_URL (produção)')
ok(!/secrets\.SUPABASE_SERVICE_ROLE_KEY\b/.test(acc), 'o job aceitação não referencia secrets.SUPABASE_SERVICE_ROLE_KEY (produção)')
ok(!/secrets\.NEXT_PUBLIC_SUPABASE_ANON_KEY\b/.test(acc), 'o job aceitação não referencia secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY (produção)')
ok(!/\b(PURL|PSRK|PANON):/.test(pr) && !/\$(PURL|PSRK|PANON)\b/.test(pr) && !/\$\{(PURL|PSRK|PANON)[:}]/.test(pr),
  'variáveis PURL/PSRK/PANON (fallback de produção) removidas — não há env nem uso delas (menção em comentário não conta)')

// o job de aceitação aborta quando ACEITACAO_BANCO != 'testes' (sem fallback de produção)
ok(/MODO_TESTES: \$\{\{ vars\.ACEITACAO_BANCO == 'testes' \}\}/.test(pr), 'MODO_TESTES vem de vars.ACEITACAO_BANCO == testes')
ok(/if \[ "\$MODO_TESTES" != "true" \]; then\s*\n\s*echo "::error::ACEITACAO_BANCO != 'testes'[\s\S]{0,200}exit 1/.test(pr),
  'ACEITACAO_BANCO != testes → aborta com erro claro (exit 1), nunca cai na produção')
ok(!/banco da aceitação: produção/.test(pr) && !/URL="\$PURL"/.test(pr), 'não há mais ramo que seleciona a produção')

// nenhum segredo de produção gravado em $GITHUB_ENV: os valores exportados vêm só das variáveis de TESTE
{
  const stepIni = pr.indexOf('- name: Selecionar o banco da vaga')
  const stepFim = pr.indexOf('- ', pr.indexOf('>> "$GITHUB_ENV"', stepIni))
  const step = pr.slice(stepIni, stepFim > 0 ? stepFim : pr.indexOf('TEST_DATABASE_URL=$DBURL', stepIni) + 60)
  ok(/SRK0: \$\{\{ secrets\.TEST_SUPABASE_SERVICE_ROLE_KEY \}\}/.test(step) && !/secrets\.SUPABASE_SERVICE_ROLE_KEY\b/.test(step),
    'o passo de banco usa só segredos TEST_* (nenhum segredo de produção exportado ao $GITHUB_ENV)')
}

// prova de comportamento: a GUARDA (reprodução do trecho) sai 1 quando não é testes e segue quando é testes
const guarda = (modo: string): number => {
  try { execFileSync('bash', ['-c', `MODO_TESTES='${modo}'; if [ "$MODO_TESTES" != "true" ]; then exit 1; fi; exit 0`]); return 0 }
  catch { return 1 }
}
ok(guarda('false') === 1 && guarda('') === 1, 'guarda: ACEITACAO_BANCO != testes (false/vazio) → exit 1 (aborta)')
ok(guarda('true') === 0, 'guarda: ACEITACAO_BANCO == testes → segue (exit 0)')

if (falhas) { console.error(`\n${falhas} falha(s) — aceitação de PR só em banco de testes`); process.exit(1) }
console.log('\ncheck-aceitacao-sem-producao: ok')
