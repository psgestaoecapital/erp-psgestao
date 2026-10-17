// Estabilidade (P1, 17/10): consultas de usuário/empresas/grupos eram refeitas a cada montagem de componente
// (179 telas usam useCompanyIds). Um laço de render virava 12–16 mil req/h e ajudou a derrubar o banco.
// Aqui: uma consulta em voo por chave (dedupe), resultado guardado por TTL e corte de repetição por minuto.
type Entrada = { em: number; promessa: Promise<unknown> }

const cache = new Map<string, Entrada>()
const chamadas = new Map<string, number[]>()

export const TTL_PADRAO_MS = 60_000
export const LIMITE_POR_MINUTO = 30

export function consultaComCache<T>(chave: string, buscar: () => Promise<T>, ttlMs = TTL_PADRAO_MS, agora = Date.now()): Promise<T> {
  const e = cache.get(chave)
  if (e && agora - e.em < ttlMs) return e.promessa as Promise<T>
  const janela = (chamadas.get(chave) ?? []).filter((t) => agora - t < 60_000)
  janela.push(agora)
  chamadas.set(chave, janela)
  if (janela.length > LIMITE_POR_MINUTO && e) {
    // laço detectado: serve o último resultado em vez de ir ao banco de novo
    if (janela.length === LIMITE_POR_MINUTO + 1 && typeof console !== 'undefined') {
      console.warn(`[PS] consulta "${chave}" repetida ${janela.length}x em 1 min — servindo o cache (possível laço de render)`)
    }
    return e.promessa as Promise<T>
  }
  const promessa = buscar().catch((err) => { if (cache.get(chave)?.promessa === promessa) cache.delete(chave); throw err })
  cache.set(chave, { em: agora, promessa })
  return promessa
}

export function limparCacheConsultas(): void { cache.clear(); chamadas.clear() }
