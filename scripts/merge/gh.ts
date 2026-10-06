// Cliente REST mínimo (o GraphQL é bloqueado na rede dos Codes — msg fbad644a). Nunca imprime o token.
export const REPO = process.env.GITHUB_REPOSITORY ?? 'psgestaoecapital/erp-psgestao'
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? ''
export async function gh<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  if (!TOKEN) throw new Error('GH_TOKEN ausente (fail-closed)')
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const txt = await r.text()
  return { status: r.status, data: (txt ? JSON.parse(txt) : null) as T }
}
