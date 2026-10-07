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

export function decidir({ env, ref, pr, arquivos }) {
  if (env === 'production' || ref === 'main') return { codigo: BUILDAR, motivo: 'produção (main) sempre builda' }
  if (!ref) return { codigo: BUILDAR, motivo: 'sem branch na Vercel (falha segura)' }
  if (pr === undefined) return { codigo: BUILDAR, motivo: 'consulta da PR falhou (falha segura)' }
  if (pr === null) return { codigo: PULAR, motivo: `branch ${ref} sem PR aberta` }
  if (pr.draft) return { codigo: PULAR, motivo: `PR #${pr.number} em rascunho (draft)` }
  if (arquivos === undefined) return { codigo: BUILDAR, motivo: 'consulta dos arquivos falhou (falha segura)' }
  if (arquivos.length > 0 && arquivos.every((f) => SO_DOCS.test(f)))
    return { codigo: PULAR, motivo: `PR #${pr.number} só muda .md/docs/.github (${arquivos.length} arquivo(s))` }
  return { codigo: BUILDAR, motivo: `PR #${pr.number} pronta com código` }
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

async function principal() {
  const env = process.env.VERCEL_ENV ?? ''
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? ''
  const dono = process.env.VERCEL_GIT_REPO_OWNER || 'psgestaoecapital'
  const repo = process.env.VERCEL_GIT_REPO_SLUG || 'erp-psgestao'
  let pr, arquivos
  if (env !== 'production' && ref && ref !== 'main') {
    try {
      const n = process.env.VERCEL_GIT_PULL_REQUEST_ID
      if (n) {
        const um = await api(`repos/${dono}/${repo}/pulls/${n}`)
        pr = um.state === 'open' ? um : null
      } else {
        const prs = await api(`repos/${dono}/${repo}/pulls?state=open&head=${encodeURIComponent(`${dono}:${ref}`)}&per_page=5`)
        pr = prs[0] ?? null
      }
    } catch (e) { console.log(`[vercel-ignore] ${e.message}`) }
    if (pr && !pr.draft) {
      try {
        arquivos = []
        for (let p = 1; p <= 30; p++) {
          const pag = await api(`repos/${dono}/${repo}/pulls/${pr.number}/files?per_page=100&page=${p}`)
          arquivos.push(...pag.map((f) => f.filename))
          if (pag.length < 100) break
        }
      } catch (e) { arquivos = undefined; console.log(`[vercel-ignore] ${e.message}`) }
    }
  }
  const d = decidir({ env, ref, pr, arquivos })
  console.log(`[vercel-ignore] ${d.codigo === BUILDAR ? 'BUILDA' : 'NÃO builda'}: ${d.motivo}`)
  process.exit(d.codigo)
}

if (import.meta.url === `file://${process.argv[1]}`) principal().catch((e) => {
  console.log(`[vercel-ignore] erro inesperado (falha segura → builda): ${e?.message ?? e}`)
  process.exit(BUILDAR)
})
