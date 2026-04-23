// src/lib/omieClient.ts
// PS Gestão ERP — Cliente da API Omie com retry + rate limiting

type OmieAuth = {
  app_key: string
  app_secret: string
}

type OmieCallOptions = {
  call: string
  param: any
  timeout?: number
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
 * Chama a API Omie com retry exponencial pra rate limit (429) e falhas temporárias (5xx)
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

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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

      // Rate limit
      if (res.status === 429) {
        const backoff = Math.pow(2, attempt) * 2000 // 2s, 4s, 8s
        console.warn(`[Omie] Rate limit. Aguardando ${backoff}ms...`)
        await sleep(backoff)
        continue
      }

      // Erro temporário do servidor Omie
      if (res.status >= 500 && res.status < 600) {
        const backoff = Math.pow(2, attempt) * 1000
        console.warn(`[Omie] Erro servidor ${res.status}. Retry em ${backoff}ms...`)
        await sleep(backoff)
        continue
      }

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Omie ${res.status}: ${text.slice(0, 500)}`)
      }

      const data = await res.json()

      // Omie às vezes retorna 200 com erro no JSON
      if (data.faultstring) {
        throw new Error(`Omie erro: ${data.faultstring}`)
      }

      return data
    } catch (err: any) {
      lastError = err
      if (err.name === 'AbortError') {
        console.warn(`[Omie] Timeout. Retry ${attempt + 1}/${maxRetries}...`)
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
