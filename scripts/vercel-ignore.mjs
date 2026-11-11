// Ignored Build Step da Vercel (CEO 07/10 — custo de Build CPU Minutes). Chamado por scripts/vercel-ignore.sh.
// Convenção da Vercel: sair com 0 = NÃO buildar (cancela o deployment); sair com 1 = buildar.
//
// NÃO gera preview quando:  (a) a PR está em rascunho (draft);  (b) a PR inteira só muda .md, docs/ ou .github/;
//                            (c) o branch não tem PR aberta.
// A produção (main) sempre builda. Consulta a API PÚBLICA do GitHub (repositório público, sem token); qualquer falha
// na consulta → builda (falha segura). Cota da API pública: 60 consultas/hora por IP, e os IPs de build da Vercel são
// compartilhados — se o CEO cadastrar a variável GITHUB_TOKEN_LEITURA no projeto da Vercel (token fine-grained SEM
// permissão nenhuma: só leitura do que já é público), o script a usa e a cota sobe para 5.000/hora. Sem ela, funciona igual.
// Quando a PR sai de draft para Ready (ou nasce depois do push), o workflow preview-pronta.yml dispara o build do head.
//
// Teste local: VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=<branch> node scripts/vercel-ignore.mjs; echo $?
const BUILDAR = 1
const PULAR = 0
export const SO_DOCS = /(\.md$|^docs\/|^\.github\/)/

export function decidir({ env, ref }) {
  if (env === 'production' || ref === 'main') return { codigo: BUILDAR, motivo: 'produção (main) sempre builda' }
  // CEO 10/11 (custo da Vercel): o preview de PR foi DESLIGADO — a compilação por PR (`next build`) passou para o
  // GitHub Actions (build-pr.yml → check "build-pr"), de graça. A Vercel builda só produção (main). Nenhuma consulta
  // ao GitHub é feita para ref ≠ main.
  return { codigo: PULAR, motivo: `preview de PR desligado (CEO 10/11) — compilação no Actions (build-pr.yml)${ref ? ` · ${ref}` : ''}` }
}

async function api(caminho) {
  const r = await fetch(`https://api.github.com/${caminho}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'erp-psgestao-vercel-ignore',
      ...(process.env.GITHUB_TOKEN_LEITURA ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN_LEITURA}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
  const resta = r.headers.get('x-ratelimit-remaining')
  if (!r.ok) throw new Error(`GitHub ${r.status} em ${caminho} (cota restante: ${resta ?? '?'})`)
  return r.json()
}

// CEO 14/10 (tarefa ed3c58bc): a tela da main não vai ao ar antes da migration do mesmo commit. Se o commit da main toca
// supabase/migrations/, o Ignored Build Step ESPERA o run do deploy-migrations daquele SHA terminar (teto ~25 min) e só
// então manda buildar. Qualquer falha na consulta ou estouro do teto → builda (falha segura, como no resto do script).
export const ESPERA_MAX_MS = 25 * 60_000
export const PASSO_MS = 20_000
export const TOCA_MIGRATION = /^supabase\/migrations\//

export async function esperarMigration({ sha, dono, repo, consulta = api, dorme = (ms) => new Promise((r) => setTimeout(r, ms)), agora = Date.now }) {
  if (!sha) return 'sem SHA: não espera'
  const arquivos = (await consulta(`repos/${dono}/${repo}/commits/${sha}`)).files ?? []
  if (!arquivos.some((f) => TOCA_MIGRATION.test(f.filename))) return 'commit sem migration: não espera'
  const limite = agora() + ESPERA_MAX_MS
  while (agora() < limite) {
    const r = await consulta(`repos/${dono}/${repo}/actions/workflows/deploy-migrations.yml/runs?head_sha=${sha}&per_page=5`)
    const run = (r.workflow_runs ?? [])[0]
    if (run && run.status === 'completed') return `deploy-migrations ${run.conclusion}: libera o build`
    await dorme(PASSO_MS)
  }
  return 'teto de espera estourado: builda mesmo assim'
}

async function principal() {
  const env = process.env.VERCEL_ENV ?? ''
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? ''
  const dono = process.env.VERCEL_GIT_REPO_OWNER || 'psgestaoecapital'
  const repo = process.env.VERCEL_GIT_REPO_SLUG || 'erp-psgestao'
  // Produção (main): espera a migration do mesmo commit (CEO 14/10) antes de liberar o build.
  if (env === 'production' || ref === 'main') {
    try {
      console.log(`[vercel-ignore] migration: ${await esperarMigration({ sha: process.env.VERCEL_GIT_COMMIT_SHA, dono, repo })}`)
    } catch (e) { console.log(`[vercel-ignore] espera da migration falhou (builda): ${e.message}`) }
  }
  // CEO 10/11: ref ≠ main → preview desligado; NÃO consulta o GitHub (acabou a dependência da cota da API pública).
  const d = decidir({ env, ref })
  console.log(`[vercel-ignore] ${d.codigo === BUILDAR ? 'BUILDA' : 'NÃO builda'}: ${d.motivo}`)
  process.exit(d.codigo)
}

if (import.meta.url === `file://${process.argv[1]}`) principal().catch((e) => {
  console.log(`[vercel-ignore] erro inesperado (falha segura → builda): ${e?.message ?? e}`)
  process.exit(BUILDAR)
})
