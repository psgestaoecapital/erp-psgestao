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
import { readdirSync } from 'node:fs'
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
export function tocaNucleoOuCompartilhado(arquivos: string[]): string | null {
  for (const f0 of arquivos) {
    const f = f0.toLowerCase()
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

// Decisão final. `arquivos` = arquivos da PR; `specs` = TODAS as specs de aceitação disponíveis (caminhos).
export function decidirEscopo(arquivos: string[], specs: string[]): Escopo {
  if (!arquivos.length) return { full: true, specs, motivo: 'sem lista de arquivos da PR — roda tudo (nunca pula)' }
  const nucleo = tocaNucleoOuCompartilhado(arquivos)
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

function main(): void {
  const arquivos = arquivosDaPr()
  const specs = listarSpecs()
  // Sem conseguir listar as specs localmente → roda tudo (o diretório é o alvo). Nunca pula.
  const d = specs.length ? decidirEscopo(arquivos, specs) : { full: true, specs: [], motivo: 'não listei as specs localmente — roda tudo' }
  process.stdout.write(JSON.stringify(d))
}

// roda só como CLI (não quando importado pelo gate check-escopo-aceitacao.ts): exige a barra antes do nome exato
if (process.argv[1] && /\/escopo-aceitacao\.ts$/.test(process.argv[1])) main()
