// Gate (CEO 10/10) — quarentena de specs @pos-migration. Prova as DUAS travas da decisão (e2e/quarentena.ts), sem rede:
//  1) "sem relação com a PR": só quarentena se a PR do 1º vermelho NÃO tocou a área do spec (área do nome × arquivos da PR);
//  2) "críticos nunca entram": financeiro/fiscal/permissões-RLS-guarda/NR-36/LGPD/Wealth sempre seguram a fila.
// Também confere: o Playwright lê a quarentena em testIgnore; o detector existe e só INCLUI por decisão (nunca apaga o
// arquivo do spec); a doutrina está no AGENTS.md.
import { readFileSync, existsSync } from 'node:fs'
import { QUARENTENA, QUARENTENA_CRITICOS, areaDoSpec, ehCritico, prTocaAreaDoSpec, podeQuarentenar, specsEmQuarentena } from '../../e2e/quarentena'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── Trava dos críticos ──
for (const spec of [
  'e2e/jornadas/aceitacao/financeiro-saldo.spec.ts',
  'e2e/jornadas/aceitacao/nfse-tomador-cliente-da-os.spec.ts',
  'e2e/jornadas/aceitacao/permissoes-rls-empresa.spec.ts',
  'e2e/jornadas/aceitacao/nr-36-ergonomia.spec.ts',
  'e2e/jornadas/aceitacao/lgpd-consentimento.spec.ts',
]) ok(ehCritico(spec) && !podeQuarentenar(spec, []).ok, `crítico nunca entra em quarentena: ${spec}`)

ok(!ehCritico('e2e/jornadas/aceitacao/mao-obra-componentes.spec.ts'), 'mao-obra não é crítico')
ok(!ehCritico('e2e/jornadas/aceitacao/pdois-tarefas-97-98.spec.ts'), 'pm/leads não é crítico')

// ── Trava "sem relação com a PR" (área do spec × arquivos da PR do 1º vermelho) ──
// Caso real 10/10: #2300 (cliente-cnpj-duplicado-guarda) — a PR tocou src/.../clientes + a migration do gatilho →
// RELACIONADA → NÃO quarentena (é regressão da PR, segura a fila).
{
  const spec = 'e2e/jornadas/aceitacao/cliente-cnpj-duplicado-guarda.spec.ts'
  const prFiles = ['src/app/dashboard/clientes/page.tsx', 'supabase/migrations/20261010160020_clientes_cnpj_duplicado_guarda.sql', 'e2e/jornadas/aceitacao/cliente-cnpj-duplicado-guarda.spec.ts']
  ok(prTocaAreaDoSpec(prFiles, spec) && !podeQuarentenar(spec, prFiles).ok, 'regressão da PR (área tocada) → NÃO quarentena, segura a fila (#2300)')
}
// Caso real 09/10: #2358 (Mão de obra HE) quebrou mao-obra-componentes — PR tocou a tela de mão de obra → relacionada.
{
  const spec = 'e2e/jornadas/aceitacao/mao-obra-componentes.spec.ts'
  const prFiles = ['src/app/dashboard/projetos/mao-obra/page.tsx']
  ok(prTocaAreaDoSpec(prFiles, spec) && !podeQuarentenar(spec, prFiles).ok, 'regressão da PR (mão de obra) → NÃO quarentena (#2358)')
}
// Caso elegível: spec de uma vertical cuja PR do 1º vermelho não toca a área (PR só de outra vertical) → quarentena.
{
  const spec = 'e2e/jornadas/aceitacao/ecommerce-loja-modelo.spec.ts'
  const prFiles = ['src/app/dashboard/projetos/mao-obra/page.tsx', 'e2e/jornadas/aceitacao/mao-obra-componentes.spec.ts']
  ok(!prTocaAreaDoSpec(prFiles, spec) && podeQuarentenar(spec, prFiles).ok, 'spec sem relação com a PR e não-crítico → PODE entrar em quarentena')
}

// ── Mecânica ──
ok(areaDoSpec('e2e/jornadas/aceitacao/mao-obra-componentes.spec.ts') === 'mao-obra', 'área derivada do nome do spec')
ok(QUARENTENA_CRITICOS.includes('financeiro') && QUARENTENA_CRITICOS.includes('fiscal') && QUARENTENA_CRITICOS.includes('guarda')
  && QUARENTENA_CRITICOS.includes('lgpd') && QUARENTENA_CRITICOS.includes('wealth'), 'lista de críticos cobre os pedidos do CEO')

// Playwright lê a quarentena em testIgnore
const pw = readFileSync('playwright.config.ts', 'utf8')
ok(/import \{ specsEmQuarentena \} from '\.\/e2e\/quarentena'/.test(pw) && /testIgnore: specsEmQuarentena\(\)/.test(pw),
  'playwright.config: testIgnore = specsEmQuarentena() (quarentenado não roda; arquivo fica)')

// O detector existe e nunca apaga o arquivo do spec (só edita o registro e2e/quarentena.ts)
ok(existsSync('scripts/merge/quarentena-detectar.ts'), 'detector scripts/merge/quarentena-detectar.ts existe')
const det = existsSync('scripts/merge/quarentena-detectar.ts') ? readFileSync('scripts/merge/quarentena-detectar.ts', 'utf8') : ''
ok(/podeQuarentenar/.test(det) && !/\brm\b|unlinkSync|rmSync/.test(det), 'detector usa a decisão podeQuarentenar e nunca apaga arquivo de spec')

// Registro começa vazio (nada em quarentena por padrão) e cada entrada é datada com motivo e os 2 runs
ok(Array.isArray(QUARENTENA) && specsEmQuarentena().length === QUARENTENA.length, 'registro de quarentena consistente')
for (const q of QUARENTENA) ok(!!q.motivo && !!q.desde && Array.isArray(q.runs) && q.runs.length === 2 && !ehCritico(q.spec),
  `entrada de quarentena datada, com motivo e 2 runs, e não-crítica: ${q.spec}`)

// AGENTS.md documenta a regra
const ag = readFileSync('AGENTS.md', 'utf8')
ok(/[Qq]uarentena/.test(ag) && /sem rela[çc][ãa]o com a PR/i.test(ag), 'AGENTS.md: doutrina da quarentena documentada')

if (falhas) { console.error(`\ncheck-quarentena: ${falhas} falha(s)`); process.exit(1) }
console.log('\nQuarentena de specs @pos-migration: ok')
