#!/usr/bin/env tsx
// Escopo da aceitação (CEO 10/10, sessão interativa) — PARTE A: encurtar o run da aceitação rodando só as jornadas
// da ÁREA tocada pela PR, com FALLBACK OBRIGATÓRIO à suíte COMPLETA quando a PR toca núcleo/compartilhado ou quando
// não dá para mapear a área com segurança. NUNCA "pula": o pior caso é rodar tudo.
//
// A serialização entre PRs NÃO muda (um banco de testes só; o grupo de concorrência demo-e2e/aceitacao-testes continua
// FIFO, uma por vez). O que muda é o TAMANHO de cada run. O cancelamento do lixo da própria PR é a PARTE B, já feita
// na triagem do aceitacao-pr.yml ("cancela runs antigos da mesma PR").
//
// Decisão (decidirEscopo) é PURA e testada pelo gate scripts/gates/check-escopo-aceitacao.ts. O CLI (main) junta os
// insumos de verdade (arquivos da PR via gh api; lista de specs via fs) e imprime JSON em stdout:
//   {"full":true|false,"specs":[...],"motivo":"..."}
// O passo do workflow lê esse JSON e monta o alvo do `npx playwright test`.
//
// Rede de segurança do sistema (por que o escopo é aceitável): o veredito que BLOQUEIA migration é o
// aceitacao-pos-migration.yml em produção (roda a suíte COMPLETA pós-merge), e a aceitacao-main.yml roda a suíte
// COMPLETA de hora em hora no banco de testes ("vermelho = corrigir em 1 h ou reverter"). Um escopo que erre por falta
// cai nessas redes — mas, por isso mesmo, qualquer dúvida aqui vira "roda tudo".
import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { QUARENTENA_CRITICOS, tokensDoSpec } from '../../e2e/quarentena'

export const DIR_ACEITACAO = 'e2e/jornadas/aceitacao'

// Tokens de caminho que NÃO identificam área (estrutura/genéricos). Ficam de fora ao extrair a área da PR.
const GENERICOS = new Set([
  'src', 'app', 'dashboard', 'page', 'tsx', 'index', 'route', 'api', 'layout', 'default', 'client', 'server',
  'components', 'component', 'lib', 'libs', 'hooks', 'hook', 'utils', 'util', 'types', 'type', 'contexts', 'context',
  'providers', 'provider', 'middleware', 'new', 'edit', 'list', 'form', 'modal', 'table', 'card', 'view', 'tab', 'tabs',
  'panel', 'section', 'item', 'items', 'detail', 'details', 'actions', 'action', 'use', 'get', 'set', 'data', 'props',
  'style', 'styles', 'css', 'json', 'test', 'tests', 'spec', 'e2e', 'jornadas', 'aceitacao', 'public', 'assets',
  'img', 'images', 'icon', 'icons', 'helpers', 'helper', 'shared', 'common', 'ui',
])

// Tokens de FEATURE dos arquivos tocados (minúsculas, 3+ letras, sem genéricos). Ex.:
// "src/app/dashboard/obras/cronograma/page.tsx" → ['obras','cronograma'].
export function tokensDeArquivos(arquivos: string[]): string[] {
  const out = new Set<string>()
  for (const f of arquivos) {
    for (const seg of f.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/)) {
      if (seg.length >= 3 && !GENERICOS.has(seg)) out.add(seg)
    }
  }
  return [...out]
}

// FALLBACK OBRIGATÓRIO: a PR toca núcleo/compartilhado? Devolve o motivo (1º arquivo que casa) ou null.
// Núcleo/compartilhado = migration, qualquer .sql (RLS/policy/grant/view/SECURITY DEFINER/guarda vivem em SQL),
// edge function, .github/**, componentes/libs/hooks/server compartilhados, layout/global do app, config raiz,
// helper de e2e (não-spec), tooling em scripts/, e qualquer caminho em área crítica (fiscal/financeiro/RLS/NR-36/LGPD/Wealth).
export function tocaNucleoOuCompartilhado(arquivos: string[], migAditivas: Set<string> = new Set()): string | null {
  for (const f0 of arquivos) {
    const f = f0.toLowerCase()
    // migration/SQL cujo CONTEÚDO é aditivo-seguro (só cria tabela nova e mexe só nela) NÃO força a suíte completa
    if ((f.startsWith('supabase/migrations/') || f.endsWith('.sql')) && migAditivas.has(f0)) continue
    if (f.startsWith('supabase/migrations/')) return `migration (${f0})`
    if (f.endsWith('.sql')) return `SQL — RLS/policy/grant/view/SECURITY DEFINER/guarda (${f0})`
    if (f.startsWith('.github/')) return `CI/.github (${f0})`
    if (f.startsWith('supabase/functions/')) return `edge function (${f0})`
    if (/^src\/(components|lib|libs|hooks|utils|types|contexts|providers|server|middleware|styles|config)\b/.test(f)) return `componente/lib compartilhado (${f0})`
    if (/^src\/app\/(layout|globals|global|providers|error|loading|not-found|template)/.test(f)) return `layout/global do app (${f0})`
    if (f === 'middleware.ts' || /^(package\.json|package-lock\.json|tsconfig|next\.config|tailwind\.config|postcss\.config|playwright\.config|vercel\.json|eslint|\.env)/.test(f)) return `config raiz (${f0})`
    if (/^e2e\//.test(f) && !/\.spec\.ts$/.test(f)) return `helper de e2e compartilhado (${f0})`
    if (/^scripts\//.test(f)) return `tooling compartilhado (${f0})`
    if (QUARENTENA_CRITICOS.some((c) => f.includes(c))) return `área crítica — fiscal/financeiro/RLS/guarda/NR-36/LGPD/Wealth (${f0})`
  }
  return null
}

export type Escopo = { full: boolean; specs: string[]; motivo: string }

// Normaliza um identificador de tabela: tira aspas, prefixo de schema e espaços; minúsculas.
function normTabela(id: string): string {
  return id.replace(/["`]/g, '').replace(/^[a-z0-9_]+\./, '').toLowerCase().trim()
}

// Papéis/roles e pseudo-nomes que NÃO são tabela (aparecem em GRANT/REVOKE e podem ser citados com segurança).
const PSEUDO_NAO_TABELA = new Set([
  'public', 'authenticated', 'anon', 'service_role', 'postgres', 'current_user', 'session_user',
  'all', 'tables', 'functions', 'sequences', 'schema', 'row', 'security', 'level', 'if', 'exists', 'not', 'on',
])

// Uma migration é ADITIVA-SEGURA para o escopo da aceitação quando SÓ cria objetos NOVOS e só mexe neles — logo
// não pode alterar o comportamento de nenhuma vertical existente, e a aceitação pode rodar só a área da PR.
// É CONSERVADORA: qualquer sinal de alteração de objeto EXISTENTE (ALTER/DROP/CREATE OR REPLACE, função nova,
// INSERT/UPDATE/DELETE em tabela que não foi criada aqui, GRANT amplo) → false (o chamador roda a suíte completa).
// A rede de segurança continua: o aceitacao-pos-migration roda a suíte COMPLETA pós-merge em produção.
export function migracaoEhAditiva(sqlBruto: string): boolean {
  // remove comentários de linha (--) e de bloco (/* */)
  const sql = sqlBruto.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
  const low = sql.toLowerCase()

  // (1) precisa criar ao menos UMA tabela nova — senão não é "migration aditiva de tabela nova"
  const novas = new Set<string>()
  for (const m of low.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."`]+)/g)) novas.add(normTabela(m[1]))
  if (!novas.size) return false

  // (2) sinais DUROS de não-aditiva — qualquer um reprova (roda tudo)
  const duros: RegExp[] = [
    /\bcreate\s+or\s+replace\b/,                                   // substitui função/view/trigger existente
    /\bcreate\s+(or\s+replace\s+)?(function|view|procedure|materialized\s+view)\b/, // função/view nova = comportamento
    /\bdrop\s+(table|function|view|schema|type|sequence|materialized|column|constraint|index|publication)\b/,
    /\btruncate\b/,
    /\bdelete\s+from\b/,
    /\bupdate\s+[a-z0-9_."`]+\s+set\b/,
    /\balter\s+(function|view|type|schema|sequence|publication|default\s+privileges|role|system)\b/,
    /\bgrant\s+[\s\S]{0,120}?\bon\s+(all|database|schema)\b/,       // grant amplo (schema/all) é compartilhado
    /\brevoke\s+[\s\S]{0,120}?\bon\s+(all|database|schema)\b/,
  ]
  for (const re of duros) if (re.test(low)) return false

  // (3) todo ALVO explícito de operação (alter/insert/policy/grant/references/trigger/on table) precisa ser tabela NOVA
  // NB: `references <existente>` (FK) é SEGURO — só impõe integridade referencial, não altera a existente; fica de fora.
  const alvos: RegExp[] = [
    /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z0-9_."`]+)/g,
    /\binsert\s+into\s+([a-z0-9_."`]+)/g,
    /\bon\s+table\s+([a-z0-9_."`]+)/g,
    /\bcreate\s+policy\s+[a-z0-9_."`]+\s+on\s+([a-z0-9_."`]+)/g,
    /\bdrop\s+policy\s+[\s\S]{0,80}?\bon\s+([a-z0-9_."`]+)/g,
    /\bcreate\s+trigger\s+[a-z0-9_."`]+[\s\S]{0,200}?\bon\s+([a-z0-9_."`]+)/g,
    /\bdrop\s+trigger\s+[\s\S]{0,80}?\bon\s+([a-z0-9_."`]+)/g,
    /\bgrant\s+[\s\S]{0,120}?\bon\s+(?:table\s+)?([a-z0-9_."`]+)/g,
    /\brevoke\s+[\s\S]{0,120}?\bon\s+(?:table\s+)?([a-z0-9_."`]+)/g,
  ]
  for (const re of alvos) {
    for (const m of low.matchAll(re)) {
      const t = normTabela(m[1])
      if (t && !novas.has(t) && !PSEUDO_NAO_TABELA.has(t)) return false
    }
  }

  // (4) bloco DO/dynamic SQL (padrão da casa: FOREACH t IN ARRAY['tab1','tab2'] ... ENABLE RLS/CREATE POLICY):
  //     todo identificador entre aspas simples que PARECE nome de tabela (snake_case) precisa ser tabela NOVA.
  if (/\bdo\s+\$/.test(low) || /\bexecute\s+format\b/.test(low)) {
    for (const m of low.matchAll(/'([a-z_][a-z0-9_]*)'/g)) {
      const t = normTabela(m[1])
      // só exige para nomes que parecem tabela de domínio (>=4 chars, com _ ); ignora papéis/keywords
      if (t.length >= 4 && t.includes('_') && !novas.has(t) && !PSEUDO_NAO_TABELA.has(t)) {
        // tolera sufixos de policy/trigger derivados do nome da tabela nova (ex.: prod_tarefa_sel)
        const ehDerivado = [...novas].some((n) => t.startsWith(n + '_') || t === n)
        if (!ehDerivado) return false
      }
    }
  }
  return true
}

// Decisão final. `arquivos` = arquivos da PR; `specs` = TODAS as specs de aceitação disponíveis (caminhos).
// `migAditivas` = conjunto de migrations da PR cujo CONTEÚDO é aditivo-seguro (ver migracaoEhAditiva); quando uma
// migration está aqui, ela NÃO força a suíte completa (o chamador — main — lê o conteúdo e preenche este conjunto).
export function decidirEscopo(arquivos: string[], specs: string[], migAditivas: Set<string> = new Set()): Escopo {
  if (!arquivos.length) return { full: true, specs, motivo: 'sem lista de arquivos da PR — roda tudo (nunca pula)' }
  const nucleo = tocaNucleoOuCompartilhado(arquivos, migAditivas)
  if (nucleo) return { full: true, specs, motivo: `fallback núcleo/compartilhado: ${nucleo}` }
  // specs de aceitação alteradas pela PRÓPRIA PR sempre entram
  const specsAlterados = arquivos.filter((f) => new RegExp(`^${DIR_ACEITACAO}/.+\\.spec\\.ts$`).test(f))
  const toks = tokensDeArquivos(arquivos)
  if (!toks.length) return { full: true, specs, motivo: 'não deu para extrair tokens de área com segurança — roda tudo' }
  const porToken = specs.filter((s) => tokensDoSpec(s).some((t) => toks.includes(t)))
  const alvo = [...new Set([...specsAlterados, ...porToken])].sort()
  if (!alvo.length) return { full: true, specs, motivo: `nenhuma jornada casou com a área (${toks.join(',')}) — roda tudo (nunca pula)` }
  return { full: false, specs: alvo, motivo: `área isolada [${toks.join(',')}] → ${alvo.length} jornada(s)` }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function listarSpecs(): string[] {
  try {
    return readdirSync(DIR_ACEITACAO).filter((n) => n.endsWith('.spec.ts')).map((n) => `${DIR_ACEITACAO}/${n}`)
  } catch { return [] }
}

function arquivosDaPr(): string[] {
  const repo = process.env.REPO ?? ''
  const sha = process.env.SHA ?? ''
  let pr = process.env.PR ?? ''
  if (!repo) return []
  const gh = (p: string) => execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', p], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  try {
    if (!pr && sha) pr = String(JSON.parse(gh(`repos/${repo}/commits/${sha}/pulls`)).filter((p: { state: string }) => p.state === 'open')[0]?.number ?? '')
    if (!pr) return []
    const files = JSON.parse(gh(`repos/${repo}/pulls/${pr}/files?per_page=100`))
    return (files ?? []).map((f: { filename: string }) => f.filename)
  } catch { return [] }
}

// Lê, dos arquivos da PR que são migration/.sql, os que têm conteúdo ADITIVO-SEGURO (migracaoEhAditiva).
// O workflow faz checkout da PR, então os arquivos estão no disco. Falha ao ler um → NÃO entra (conservador: roda tudo).
function migracoesAditivas(arquivos: string[]): Set<string> {
  const out = new Set<string>()
  for (const f of arquivos) {
    if (!f.startsWith('supabase/migrations/') && !f.endsWith('.sql')) continue
    try {
      if (migracaoEhAditiva(readFileSync(f, 'utf8'))) out.add(f)
    } catch { /* não leu → não é aditiva-segura → roda tudo */ }
  }
  return out
}

function main(): void {
  const arquivos = arquivosDaPr()
  const specs = listarSpecs()
  const migAditivas = migracoesAditivas(arquivos)
  // Sem conseguir listar as specs localmente → roda tudo (o diretório é o alvo). Nunca pula.
  const d = specs.length ? decidirEscopo(arquivos, specs, migAditivas) : { full: true, specs: [], motivo: 'não listei as specs localmente — roda tudo' }
  process.stdout.write(JSON.stringify(d))
}

// roda só como CLI (não quando importado pelo gate check-escopo-aceitacao.ts): exige a barra antes do nome exato
if (process.argv[1] && /\/escopo-aceitacao\.ts$/.test(process.argv[1])) main()
