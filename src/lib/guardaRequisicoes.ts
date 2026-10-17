// P1 estabilidade (CEO 17/10): um navegador chegou a 12–16 mil requisições/h em laço e ajudou a derrubar o banco.
// Esta guarda fica no fetch do cliente Supabase e (1) junta GETs idênticos que estão em voo (uma ida ao servidor só) e
// (2) corta a repetição: a MESMA consulta mais de LIMITE vezes na janela é barrada por um tempo, com aviso no console.
// Não toca em login/refresh de token nem em escrita (POST/PATCH/DELETE fora de rpc).

export const LIMITE_REPETICAO = 60
export const JANELA_MS = 60_000
export const BLOQUEIO_MS = 30_000

type Estado = { marcas: number[]; bloqueadoAte: number }

export function criarGuarda(agora: () => number = Date.now, aviso: (msg: string) => void = (m) => console.error(m)) {
  const estados = new Map<string, Estado>()

  /** Chave da consulta repetível, ou null quando a chamada não passa pela guarda. */
  function chave(metodo: string, url: string, corpo?: string): string | null {
    const m = metodo.toUpperCase()
    let caminho = url
    try { const u = new URL(url, 'http://x'); caminho = u.pathname + u.search } catch { /* mantém a url crua */ }
    if (caminho.includes('/auth/v1/token')) return null
    if (m === 'GET' || m === 'HEAD') return `${m} ${caminho}`
    if (m === 'POST' && caminho.includes('/rest/v1/rpc/')) return `${m} ${caminho} ${corpo ?? ''}`
    return null
  }

  /** Registra a chamada. false = barrada (laço). */
  function permitir(k: string): boolean {
    const t = agora()
    const e = estados.get(k) ?? { marcas: [], bloqueadoAte: 0 }
    estados.set(k, e)
    if (t < e.bloqueadoAte) return false
    e.marcas = e.marcas.filter((x) => t - x < JANELA_MS)
    e.marcas.push(t)
    if (e.marcas.length > LIMITE_REPETICAO) {
      e.bloqueadoAte = t + BLOQUEIO_MS
      e.marcas = []
      aviso(`[guarda-requisicoes] laço interrompido: "${k.slice(0, 160)}" repetida mais de ${LIMITE_REPETICAO}x em ${JANELA_MS / 1000}s; bloqueada por ${BLOQUEIO_MS / 1000}s.`)
      return false
    }
    if (estados.size > 500) for (const [kk, ee] of estados) if (t - (ee.marcas[ee.marcas.length - 1] ?? 0) > JANELA_MS && t >= ee.bloqueadoAte) estados.delete(kk)
    return true
  }

  return { chave, permitir }
}

const RESPOSTA_BARRADA = () => new Response(JSON.stringify({ message: 'Requisição repetida em laço, interrompida pelo navegador', code: 'LACO_BLOQUEADO' }), {
  status: 429, headers: { 'content-type': 'application/json' },
})

/** Envolve um fetch com a guarda + junção de GETs idênticos em voo. */
export function fetchComGuardaDeLaco(base: typeof fetch, guarda = criarGuarda()): typeof fetch {
  const emVoo = new Map<string, Promise<Response>>()
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const metodo = init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')
    const corpo = typeof init?.body === 'string' ? init.body : undefined
    const k = guarda.chave(metodo, url, corpo)
    if (k === null) return base(input, init)
    if (!guarda.permitir(k)) return RESPOSTA_BARRADA()
    const sinal = init?.signal
    if (metodo.toUpperCase() === 'GET' && !sinal) {
      // sem AbortSignal próprio: pode compartilhar a mesma ida ao servidor (cada chamador recebe um clone)
      const chaveVoo = k + '|' + JSON.stringify(init?.headers ?? {})
      let p = emVoo.get(chaveVoo)
      if (!p) { p = base(input, init).finally(() => { emVoo.delete(chaveVoo) }); emVoo.set(chaveVoo, p) }
      return (await p).clone()
    }
    return base(input, init)
  }
}
