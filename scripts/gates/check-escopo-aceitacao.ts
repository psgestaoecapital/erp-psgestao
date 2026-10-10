// Gate (CEO 10/10, sessão interativa) — ESCOPO da aceitação: encurtar o run rodando só a ÁREA da PR, com fallback
// OBRIGATÓRIO à suíte COMPLETA para núcleo/compartilhado e para área não-mapeável (NUNCA pula). A serialização entre
// PRs (grupo demo-e2e/aceitacao-testes, FIFO, uma por vez) NÃO muda — só o tamanho do run. O cancelamento do lixo da
// própria PR (Parte B) já vive na triagem do aceitacao-pr.yml.
//
// Parte 1: fiação do workflow. Parte 2: a decisão pura (decidirEscopo) nos 4 cenários do CEO.
import { readFileSync } from 'node:fs'
import { decidirEscopo, tocaNucleoOuCompartilhado, tokensDeArquivos, DIR_ACEITACAO } from '../merge/escopo-aceitacao'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Parte 1: workflow ────────────────────────────────────────────────────────────────────────────────────────────
const wf = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
ok(/- name: Escopo da aceitação/.test(wf) && /npx tsx scripts\/merge\/escopo-aceitacao\.ts/.test(wf),
  'passo "Escopo da aceitação" chama o script escopo-aceitacao.ts')
ok(/ACEITACAO_ALVO=\$alvo/.test(wf) && (wf.match(/\$\{ACEITACAO_ALVO:-e2e\/jornadas\/aceitacao\}/g) ?? []).length === 2,
  'os DOIS `playwright test` usam $ACEITACAO_ALVO (com fallback ao diretório inteiro)')
ok(!/npx playwright test e2e\/jornadas\/aceitacao --project/.test(wf), 'nenhum run roda a suíte inteira fixa (sempre pelo alvo)')
// serialização entre PRs intacta: grupo demo-e2e/aceitacao-testes, FIFO, nunca cancel-in-progress:true
const aceit = wf.slice(wf.indexOf('\n  aceitacao:'))
ok(/group: \$\{\{ vars\.ACEITACAO_BANCO == 'testes' &&[^\n]*aceitacao-testes[^\n]*'demo-e2e' \}\}/.test(aceit)
  && /queue: max/.test(aceit) && !/cancel-in-progress: true/.test(aceit),
  'serialização entre PRs intacta (grupo demo-e2e/aceitacao-testes por vaga, queue:max, sem cancel-in-progress)')
// Parte B (CEO 10/10): a triagem libera a vaga chamando o prune compartilhado (cancela PR morta / SHA superado)
const tri = wf.slice(wf.indexOf('  triagem:'), wf.indexOf('  aceitacao:'))
ok(/- name: Liberar vaga/.test(tri) && /scripts\/merge\/aceitacao-prune\.sh/.test(tri),
  'Parte B: triagem libera a vaga via aceitacao-prune.sh (PR morta / SHA superado), sem esperar os 90 min')

// ── Parte 2: decisão pura ────────────────────────────────────────────────────────────────────────────────────────
const SPECS = [
  `${DIR_ACEITACAO}/caminho-obras-cronograma.spec.ts`,
  `${DIR_ACEITACAO}/obras-medicao.spec.ts`,
  `${DIR_ACEITACAO}/caminho-financeiro-pagar.spec.ts`,
  `${DIR_ACEITACAO}/pm-copiar-job.spec.ts`,
  `${DIR_ACEITACAO}/seguranca-rls-internas.spec.ts`,
]

// 1) PR de área isolada (front de obras) → roda SÓ as jornadas de obras, não tudo
{
  const d = decidirEscopo(['src/app/dashboard/obras/cronograma/page.tsx'], SPECS)
  ok(d.full === false
    && d.specs.includes(`${DIR_ACEITACAO}/caminho-obras-cronograma.spec.ts`)
    && d.specs.includes(`${DIR_ACEITACAO}/obras-medicao.spec.ts`)
    && !d.specs.includes(`${DIR_ACEITACAO}/pm-copiar-job.spec.ts`)
    && !d.specs.includes(`${DIR_ACEITACAO}/caminho-financeiro-pagar.spec.ts`),
    '1) área isolada (obras) → escopo só nas jornadas de obras (run curto)')
}

// 2) núcleo/migration/RLS/fiscal/.github/compartilhado → FALLBACK à suíte completa
for (const [arq, rot] of [
  ['supabase/migrations/20261010170030_x.sql', 'migration'],
  ['db/policies/cliente_rls.sql', '.sql/RLS'],
  ['src/app/dashboard/fiscal/nfe/page.tsx', 'fiscal/nfe'],
  ['src/components/Botao.tsx', 'componente compartilhado'],
  ['src/lib/supabase.ts', 'lib compartilhada'],
  ['.github/workflows/x.yml', '.github'],
  ['supabase/functions/sync/index.ts', 'edge function'],
  ['package.json', 'config raiz'],
] as [string, string][]) {
  const d = decidirEscopo([arq, 'src/app/dashboard/obras/page.tsx'], SPECS)
  ok(d.full === true, `2) fallback → suíte completa quando toca ${rot} (${arq})`)
}

// 2b) tocaNucleoOuCompartilhado isola o motivo
ok(tocaNucleoOuCompartilhado(['supabase/migrations/1_x.sql']) !== null
  && tocaNucleoOuCompartilhado(['src/app/dashboard/obras/page.tsx']) === null,
  '2b) detector de núcleo: migration=sim, front de obras=não')

// 3) área NÃO-mapeável com segurança (só caminho genérico) → roda tudo (nunca pula)
{
  const d = decidirEscopo(['src/app/dashboard/page.tsx'], SPECS)
  ok(d.full === true && /roda tudo/.test(d.motivo), '3) área não-mapeável (tokens só genéricos) → roda tudo (nunca pula)')
  const vazio = decidirEscopo([], SPECS)
  ok(vazio.full === true, '3b) sem lista de arquivos → roda tudo')
}

// 4) spec de aceitação alterada pela própria PR SEMPRE entra no alvo
{
  const d = decidirEscopo([`${DIR_ACEITACAO}/pm-copiar-job.spec.ts`], SPECS)
  ok(d.full === false && d.specs.includes(`${DIR_ACEITACAO}/pm-copiar-job.spec.ts`),
    '4) spec alterada na PR entra no alvo (sem rodar tudo à toa)')
}

// 5) tokens de área ignoram genéricos (src/app/dashboard/page/tsx...) e mantêm a feature
ok(tokensDeArquivos(['src/app/dashboard/obras/cronograma/page.tsx']).sort().join(',') === 'cronograma,obras',
  '5) tokensDeArquivos extrai só a feature (obras,cronograma), sem genéricos')

if (falhas) { console.error(`\ncheck-escopo-aceitacao: ${falhas} falha(s)`); process.exit(1) }
console.log('\nEscopo da aceitação: ok')
