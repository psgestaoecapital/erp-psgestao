// Bloco 1 (Pdois, CEO 02/10) — regras puras do briefing e da busca de cliente, testadas no build
// (scripts/gates/check-pm-bloco1.ts).

// Briefing completo que vai para o job: objetivo, público, prazo e referências + o texto do briefing.
export function briefingParaJob(b: { objetivo?: string | null; publico_alvo?: string | null; referencias?: string | null; descricao?: string | null; prazo_desejado?: string | null }): string {
  const partes: string[] = []
  if (b.objetivo?.trim()) partes.push(`**Objetivo:** ${b.objetivo.trim()}`)
  if (b.publico_alvo?.trim()) partes.push(`**Público-alvo:** ${b.publico_alvo.trim()}`)
  if (b.prazo_desejado) partes.push(`**Prazo desejado:** ${b.prazo_desejado.slice(0, 10).split('-').reverse().join('/')}`)
  if (b.referencias?.trim()) partes.push(`**Referências:** ${b.referencias.trim()}`)
  if (b.descricao?.trim()) partes.push(b.descricao.trim())
  return partes.join('\n\n')
}

// Termo seguro para o filtro "or" do PostgREST (vírgula, parênteses, % e * quebram a busca).
export const termoBusca = (q: string) => q.replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

// Link do editor: só http(s); sem esquema vira https.
export const linkSeguro = (url: string) => (/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim().replace(/^[a-z]+:/i, '')}`)
