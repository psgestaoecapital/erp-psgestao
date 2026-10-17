// P1 17/10 (laço de requisições, 12–16 mil/h): disjuntor de leituras REPETIDAS no cliente.
// Conta pedidos idênticos (método + URL) numa janela deslizante; passou do limite, o excedente é cortado
// até a janela esvaziar. Só leituras (GET /rest/v1 e /auth/v1/user) — escrita e refresh de token nunca passam por aqui.
export const DISJUNTOR_LIMITE = 150
export const DISJUNTOR_JANELA_MS = 5 * 60_000

export function chaveDeLeitura(metodo: string, url: string): string | null {
  if (metodo.toUpperCase() !== 'GET') return null
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.pathname.startsWith('/rest/v1/') || u.pathname === '/auth/v1/user') return `GET ${u.pathname}${u.search}`
  return null
}

export function criarDisjuntor(limite = DISJUNTOR_LIMITE, janelaMs = DISJUNTOR_JANELA_MS) {
  const marcas = new Map<string, number[]>()
  const avisadas = new Set<string>()
  // true = pode seguir; false = cortado (laço).
  return function permitir(chave: string, agora = Date.now()): boolean {
    const recentes = (marcas.get(chave) ?? []).filter((t) => agora - t < janelaMs)
    if (recentes.length >= limite) {
      marcas.set(chave, recentes)
      if (!avisadas.has(chave)) {
        avisadas.add(chave)
        // eslint-disable-next-line no-console
        console.error(`[disjuntor] ${recentes.length}+ pedidos idênticos em ${Math.round(janelaMs / 60_000)} min — laço interrompido: ${chave}`)
      }
      return false
    }
    avisadas.delete(chave)
    recentes.push(agora)
    marcas.set(chave, recentes)
    return true
  }
}
