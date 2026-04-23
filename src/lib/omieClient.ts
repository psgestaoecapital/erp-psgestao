// src/lib/omieClient.ts
// PS Gestão ERP — Cliente da API Omie com retry + rate limiting

type OmieAuth = {
  app_key: string
  app_secret: string
}

export type OmieCallLog = {
  endpoint: string
  call: string
  params: any
  attempt: number
  durationMs: number
  status: 'success' | 'error' | 'timeout' | 'rate_limit'
  httpStatus?: number | null
  errorMessage?: string | null
  responseBodyPreview?: string | null
}

type OmieCallOptions = {
  call: string
  param: any
  timeout?: number
  // Callback opcional — é chamado a cada tentativa (sucesso ou falha).
  // Permite persistir logs sem acoplar omieClient a Supabase.
  onLog?: (entry: OmieCallLog) => void | Promise<void>
}

const OMIE_BASE = 'https://app.omie.com.br/api/v1/'

// ═══ Endpoints Omie ═══
const ENDPOINTS: Record<string, string> = {
  // Fornecedores (usa mesma API de Cliente com flag "inativo": "N" e filtro tag de fornecedor)
  'ListarFornecedores': 'geral/clientes/',
  // Clientes
  'ListarClientes': 'geral/clientes/',
  'ConsultarCliente': 'geral/clientes/',
  // Produtos
  'ListarProdutos': 'geral/produtos/',
  'ConsultarProduto': 'geral/produtos/',
  // Contas
  'ListarContasPagar': 'financas/contapagar/',
  'ListarContasReceber': 'financas/contareceber/',
  // Categorias / Plano de Contas
  'ListarCategorias': 'geral/categorias/',
  // Movimento
  'ListarEstoque': 'estoque/consulta/',
}

/**
 * Chama a API Omie com retry exponencial pra rate limit (429) e falhas temporárias (5xx).
 *
 * Política de retry:
 * - 429 / "Too Many Requests" (SOAP): aguarda 60s e tenta de novo UMA vez.
 *   Se o segundo 429 ocorrer, propaga erro rate_limit.
 * - 5xx / network / timeout: mantém a estratégia existente (até 3 tentativas
 *   com backoff crescente — compatível com callers legados de /api/sync/omie/*).
 *
 * Se `opts.onLog` for fornecido, é chamado a cada tentativa com métricas
 * completas (attempt, durationMs, status, httpStatus, errorMessage,
 * responseBodyPreview). Callback não deve lançar — falhas do log são
 * engolidas para não derrubar o fluxo principal.
 */
export async function omieCall(auth: OmieAuth, opts: OmieCallOptions): Promise<any> {
  const endpoint = ENDPOINTS[opts.call]
  if (!endpoint) throw new Error(`Endpoint Omie desconhecido: ${opts.call}`)

  const body = {
    call: opts.call,
    app_key: auth.app_key,
    app_secret: auth.app_secret,
    param: Array.isArray(opts.param) ? opts.param : [opts.param],
  }

  const url = OMIE_BASE + endpoint
  const maxRetries = 3
  let lastError: any
  let rateLimitWaited = false

  const doLog = async (entry: OmieCallLog) => {
    if (!opts.onLog) return
    try {
      await opts.onLog(entry)
    } catch {
      // best-effort
    }
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const startedAt = Date.now()
    try {
      const controller = new AbortController()
      const timeoutMs = opts.timeout || 30000
      const t = setTimeout(() => controller.abort(), timeoutMs)

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(t)

      const durationMs = Date.now() - startedAt

      // Rate limit: política nova — espera 60s UMA vez só.
      if (res.status === 429) {
        const bodyText = await res.text().catch(() => '')
        const preview = bodyText.slice(0, 500)
        await doLog({
          endpoint,
          call: opts.call,
          params: opts.param,
          attempt: attempt + 1,
          durationMs,
          status: 'rate_limit',
          httpStatus: 429,
          errorMessage: 'HTTP 429 Too Many Requests',
          responseBodyPreview: preview,
        })
        if (rateLimitWaited) {
          throw new Error('Omie 429: rate limit persistente após espera de 60s')
        }
        rateLimitWaited = true
        console.warn('[Omie] 429 — aguardando 60s antes da próxima tentativa')
        await sleep(60000)
        continue
      }

      // Erro temporário do servidor Omie
      if (res.status >= 500 && res.status < 600) {
        const bodyText = await res.text().catch(() => '')
        const preview = bodyText.slice(0, 500)
        await doLog({
          endpoint,
          call: opts.call,
          params: opts.param,
          attempt: attempt + 1,
          durationMs,
          status: 'error',
          httpStatus: res.status,
          errorMessage: `HTTP ${res.status}`,
          responseBodyPreview: preview,
        })
        const backoff = Math.pow(2, attempt) * 1000
        console.warn(`[Omie] Erro servidor ${res.status}. Retry em ${backoff}ms...`)
        await sleep(backoff)
        continue
      }

      if (!res.ok) {
        const text = await res.text()
        await doLog({
          endpoint,
          call: opts.call,
          params: opts.param,
          attempt: attempt + 1,
          durationMs,
          status: 'error',
          httpStatus: res.status,
          errorMessage: `HTTP ${res.status}`,
          responseBodyPreview: text.slice(0, 500),
        })
        throw new Error(`Omie ${res.status}: ${text.slice(0, 500)}`)
      }

      const data = await res.json()

      // Omie às vezes retorna 200 com erro no JSON
      if (data.faultstring) {
        const isRateLimit = /too many requests|SOAP-ENV:Server.*rate/i.test(
          String(data.faultstring)
        )
        await doLog({
          endpoint,
          call: opts.call,
          params: opts.param,
          attempt: attempt + 1,
          durationMs,
          status: isRateLimit ? 'rate_limit' : 'error',
          httpStatus: 200,
          errorMessage: String(data.faultstring).slice(0, 2000),
          responseBodyPreview: JSON.stringify(data).slice(0, 500),
        })
        if (isRateLimit) {
          if (rateLimitWaited) {
            throw new Error(`Omie rate limit persistente: ${data.faultstring}`)
          }
          rateLimitWaited = true
          console.warn('[Omie] SOAP rate limit — aguardando 60s')
          await sleep(60000)
          continue
        }
        throw new Error(`Omie erro: ${data.faultstring}`)
      }

      await doLog({
        endpoint,
        call: opts.call,
        params: opts.param,
        attempt: attempt + 1,
        durationMs,
        status: 'success',
        httpStatus: res.status,
      })
      return data
    } catch (err: any) {
      lastError = err
      const durationMs = Date.now() - startedAt
      const isAbort = err.name === 'AbortError'
      if (isAbort) {
        console.warn(`[Omie] Timeout. Retry ${attempt + 1}/${maxRetries}...`)
        await doLog({
          endpoint,
          call: opts.call,
          params: opts.param,
          attempt: attempt + 1,
          durationMs,
          status: 'timeout',
          errorMessage: `timeout após ${opts.timeout || 30000}ms`,
        })
      } else {
        console.error(`[Omie] Erro: ${err.message}`)
      }
      if (attempt < maxRetries - 1) await sleep(1000 * (attempt + 1))
    }
  }

  throw lastError || new Error('Omie call failed after retries')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Busca todos os registros paginados da Omie
 * @returns array completo concatenado
 */
export async function omiePaginate<T>(
  auth: OmieAuth,
  call: string,
  paramBuilder: (pagina: number) => any,
  extractor: (response: any) => { items: T[]; totalPaginas: number; totalRegistros: number }
): Promise<T[]> {
  const all: T[] = []
  let pagina = 1
  let totalPaginas = 1

  while (pagina <= totalPaginas) {
    const response = await omieCall(auth, {
      call,
      param: paramBuilder(pagina),
    })

    const { items, totalPaginas: tp, totalRegistros } = extractor(response)
    all.push(...items)
    totalPaginas = tp

    console.log(`[Omie] ${call} — página ${pagina}/${totalPaginas} — ${items.length} itens (total até agora: ${all.length}/${totalRegistros})`)

    if (items.length === 0) break // guard
    pagina++

    // Respeita rate limit ~60 req/min = 1 req/s (ser conservador: 1.5s)
    if (pagina <= totalPaginas) await sleep(1500)
  }

  return all
}

/**
 * Pega credenciais Omie da tabela api_integrations
 */
export async function getOmieAuthFromDb(supabase: any, companyId: string): Promise<OmieAuth | null> {
  const { data } = await supabase
    .from('api_integrations')
    .select('credentials')
    .eq('company_id', companyId)
    .eq('provider', 'omie')
    .eq('active', true)
    .single()

  if (!data?.credentials) return null

  const creds = typeof data.credentials === 'string' ? JSON.parse(data.credentials) : data.credentials
  return {
    app_key: creds.app_key,
    app_secret: creds.app_secret,
  }
}
