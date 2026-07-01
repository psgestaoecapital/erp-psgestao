// Sicoob Cobranca V3 + Pix hibrido — auth OAuth2 (client_credentials) + mTLS.
// Node runtime only (mTLS via https.Agent com .pfx).
//
// Espelha o adapter Bradesco: erp_banco_provider_config -> Vault -> mTLS.
// Auth pelo Keycloak Sicoob (form-url-encoded, client_id no corpo, sem
// client_secret — eh autenticado pelo certificado A1).
import https from 'node:https'
import { Buffer } from 'node:buffer'

export type SicoobAmbiente = 'producao' | 'homologacao'

// Bases confirmadas (developers.sicoob.com.br). Homologacao usa o mesmo host
// publico em algumas rotas — confirmar com a doc oficial no gerente.
const AUTH_HOST = 'auth.sicoob.com.br'
const AUTH_PATH = '/auth/realms/cooperado/protocol/openid-connect/token'
const API_HOST: Record<SicoobAmbiente, string> = {
  producao: 'api.sicoob.com.br',
  homologacao: 'sandbox.sicoob.com.br',
}

// Escopo: o Keycloak do Sicoob dispara invalid_scope quando recebe
// varios scopes na mesma requisicao (bug keycloak#42877). Os escopos
// estao todos vinculados ao app no portal — pedimos UM por requisicao
// conforme a operacao. Cada token (e cada entrada de cache) e por scope.
export const SICOOB_SCOPE_INCLUIR_BOLETO = 'boletos_inclusao'
export const SICOOB_SCOPE_CONSULTAR_BOLETO = 'boletos_consulta'

export type Credencial = {
  client_id: string
  ambiente: SicoobAmbiente
  pfx: Buffer
  passphrase: string
  cooperativa: string
  conta: string
  codigo_beneficiario: string
  convenio: string
}

type TokenCacheEntry = { access_token: string; expires_at: number }
const tokenCache = new Map<string, TokenCacheEntry>()

type HttpResult<T> = { status: number; body: T; raw: string }

function request<T = unknown>(opts: {
  host: string; path: string; method: 'GET' | 'POST'
  headers?: Record<string, string>; body?: string
  pfx: Buffer; passphrase: string
}): Promise<HttpResult<T>> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: opts.host, port: 443, path: opts.path, method: opts.method,
      headers: { 'accept': 'application/json', ...(opts.headers ?? {}) },
      pfx: opts.pfx, passphrase: opts.passphrase,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        let parsed: unknown = raw
        try { parsed = raw ? JSON.parse(raw) : null } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed as T, raw })
      })
    })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

export async function obterToken(c: Credencial, scope: string = SICOOB_SCOPE_INCLUIR_BOLETO): Promise<string> {
  const key = `${c.client_id}:${c.ambiente}:${scope}`
  const hit = tokenCache.get(key)
  if (hit && hit.expires_at > Date.now()) return hit.access_token

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: c.client_id,
    scope,
  }).toString()

  const res = await request<{ access_token?: string; expires_in?: number; error?: string; error_description?: string }>({
    host: AUTH_HOST, path: AUTH_PATH, method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': String(body.length),
    },
    body, pfx: c.pfx, passphrase: c.passphrase,
  })
  if (res.status !== 200 || !res.body?.access_token) {
    throw new Error(`Sicoob auth falhou: ${res.status} ${res.raw.slice(0, 300)}`)
  }
  const ttlMs = Math.max(60, (res.body.expires_in ?? 3600) - 60) * 1000
  tokenCache.set(key, { access_token: res.body.access_token, expires_at: Date.now() + ttlMs })
  return res.body.access_token
}

const onlyDigits = (s: string) => (s ?? '').replace(/\D/g, '')
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const cleanText = (s: string | null | undefined, max = 40) =>
  stripAccents((s ?? '').trim()).replace(/\s+/g, ' ').slice(0, max)

export type PagadorInput = {
  tipo: 'PF' | 'PJ'
  documento: string
  nome: string
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
}

export type RegistrarBoletoInput = {
  cred: Credencial
  seuNumero: string
  valor: number
  emissaoISO: string
  vencimentoISO: string
  pagador: PagadorInput
  hibrido?: boolean              // boleto + Pix QR
  codigoModalidade?: number      // default 1 (simples com registro)
  codigoEspecieDocumento?: string // default 'DM' (Duplicata Mercantil)
  mensagens?: Array<string | null | undefined>
}

export type RegistroResult = {
  status: number
  nuTituloGerado?: string
  linhaDigitavel?: string
  codigoBarras?: string
  qrCode?: string
  raw: unknown
  payload_resumo?: Record<string, unknown>
}

export async function registrarBoleto(input: RegistrarBoletoInput): Promise<RegistroResult> {
  const c = input.cred
  const token = await obterToken(c)
  const documentoPagador = onlyDigits(input.pagador.documento)

  const payload: Record<string, unknown> = {
    numeroCliente: Number(c.codigo_beneficiario),
    codigoModalidade: input.codigoModalidade ?? 1,
    numeroContaCorrente: Number(onlyDigits(c.conta)),
    codigoEspecieDocumento: input.codigoEspecieDocumento ?? 'DM',
    dataEmissao: input.emissaoISO,
    seuNumero: input.seuNumero.slice(0, 25),
    identificacaoEmissaoBoleto: 1,
    identificacaoDistribuicaoBoleto: 1,
    valor: Number(input.valor.toFixed(2)),
    dataVencimento: input.vencimentoISO,
    numeroParcela: 1,
    aceite: true,
    // Sicoob V3 exige tipoJurosMora na raiz, mesmo sem juros.
    // 1=valor/dia, 2=taxa mensal, 3=isento. Usamos 3 (sem juros).
    tipoJurosMora: 3,
    // Idem multa: campo obrigatorio mesmo sem multa.
    // 0=isento, 1=valor fixo, 2=percentual.
    tipoMulta: 0,
    // Desconto: Sicoob V3 aceita tipoDesconto:0 (sem desconto) — desde
    // que NAO enviemos nem dataPrimeiroDesconto nem valorPrimeiroDesconto.
    // Com tipoDesconto:1 (valor fixo) os dois campos viram obrigatorios
    // (erro 5002 "Data e Valor do Primeiro Desconto obrigatorio"),
    // entao usamos 0 puro. Omitir tipoDesconto ainda da "invalido".
    tipoDesconto: 0,
    // Sicoob V3 — schema pagador: { numeroCpfCnpj, nome, endereco,
    // bairro, cidade, cep, uf, email }. 'logradouro'/'tipoPessoa' nao
    // existem — Sicoob deriva PF/PJ pelo tamanho do CPF/CNPJ.
    pagador: {
      numeroCpfCnpj: documentoPagador,
      nome: cleanText(input.pagador.nome, 70),
      endereco: cleanText(input.pagador.logradouro ?? '', 40),
      bairro: cleanText(input.pagador.bairro ?? '', 40),
      cidade: cleanText(input.pagador.cidade ?? '', 30),
      cep: onlyDigits(input.pagador.cep ?? ''),
      uf: cleanText(input.pagador.uf ?? '', 2).toUpperCase(),
    },
  }
  // TODO(pix-hibrido): Sicoob V3 NAO aceita 'hibrido' no payload — gera
  // erro 0004 "Propriedade inesperada". O flag input.hibrido permanece
  // como parametro interno (futura ligacao Pix). O campo correto do
  // schema V3 (provavel: 'gerarPixVinculado') precisa ser confirmado
  // na doc autenticada do portal antes de ligar. Por enquanto, registro
  // emite so o boleto.
  void input.hibrido
  if (input.mensagens && input.mensagens.length > 0) {
    payload.mensagensInstrucao = input.mensagens
      .filter((m): m is string => !!m && m.trim().length > 0)
      .slice(0, 5)
      .map((m) => cleanText(m, 80))
  }

  const body = JSON.stringify(payload)
  const res = await request<unknown>({
    host: API_HOST[c.ambiente],
    path: '/cobranca-bancaria/v3/boletos',
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'client_id': c.client_id,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body, pfx: c.pfx, passphrase: c.passphrase,
  })

  const resumo: Record<string, unknown> = { ...payload }
  const pag = resumo.pagador as Record<string, unknown> | undefined
  if (pag && typeof pag.numeroCpfCnpj === 'string') {
    pag.numeroCpfCnpj = (pag.numeroCpfCnpj as string).replace(/^(\d{3})(\d+)(\d{2})$/, '$1***$3')
  }
  resumo._endpoint = `https://${API_HOST[c.ambiente]}/cobranca-bancaria/v3/boletos`

  if (res.status < 200 || res.status >= 300) {
    return { status: res.status, raw: res.body, payload_resumo: resumo }
  }
  const data = (res.body as { resultado?: Record<string, unknown> } | null)?.resultado
    ?? (res.body as Record<string, unknown> | null)
    ?? null
  return {
    status: res.status,
    nuTituloGerado: (data?.nossoNumero as string | number | undefined)?.toString(),
    linhaDigitavel: data?.linhaDigitavel as string | undefined,
    codigoBarras: data?.codigoBarras as string | undefined,
    qrCode: data?.qrCode as string | undefined,
    raw: res.body,
    payload_resumo: resumo,
  }
}

export type SegundaViaResult = {
  status: number
  pdfBase64?: string
  raw: unknown
}

// GET 2a via do boleto (PDF base64) — token com scope 'boletos_consulta'.
// Query: numeroCliente, codigoModalidade, nossoNumero, gerarPdfBoleto=true.
// Sem gerarPdfBoleto=true o Sicoob retorna so os DADOS do boleto (valor,
// linhaDigitavel, qrCode, pagador...) sem o campo de PDF. Com a flag, vem
// 'pdfBoleto' base64. Mantemos fallbacks de nome porque a doc varia entre
// ambientes (boletoPdf, pdfBase64, etc.).
export async function segundaViaBoleto(
  c: Credencial,
  nossoNumero: string | number,
  codigoModalidade = 1,
): Promise<SegundaViaResult> {
  const token = await obterToken(c, SICOOB_SCOPE_CONSULTAR_BOLETO)
  const qs = new URLSearchParams({
    numeroCliente: String(c.codigo_beneficiario),
    codigoModalidade: String(codigoModalidade),
    nossoNumero: String(nossoNumero),
    gerarPdfBoleto: 'true',
  }).toString()
  const res = await request<unknown>({
    host: API_HOST[c.ambiente],
    path: `/cobranca-bancaria/v3/boletos/segunda-via?${qs}`,
    method: 'GET',
    headers: {
      'authorization': `Bearer ${token}`,
      'client_id': c.client_id,
    },
    pfx: c.pfx, passphrase: c.passphrase,
  })
  if (res.status < 200 || res.status >= 300) {
    return { status: res.status, raw: res.body }
  }
  const data = (res.body as { resultado?: Record<string, unknown> } | null)?.resultado
    ?? (res.body as Record<string, unknown> | null)
    ?? {}
  const pdfBase64 = (data?.pdfBoleto
    ?? data?.boletoPdf
    ?? data?.pdfBase64
    ?? data?.pdf
    ?? data?.arquivoPdf) as string | undefined
  return { status: res.status, pdfBase64, raw: res.body }
}

export type ConsultaBoletoResult = {
  status: number
  situacao: string | null
  dataLiquidacao: string | null
  valorPago: number | null
  raw: unknown
}

// GET consulta do boleto (situacao/pagamento). Reusa obterToken com
// scope 'boletos_consulta' — mesma logica da segundaVia. Retorna
// campos normalizados p/ nossa camada:
//   situacao: string upper (LIQUIDADO/EM_ABERTO/BAIXADO/...)
//   dataLiquidacao: ISO date se pago
//   valorPago: numeric se pago
// + raw pra registrar no log de webhook.
export async function consultarBoleto(
  c: Credencial,
  nossoNumero: string | number,
  codigoModalidade = 1,
): Promise<ConsultaBoletoResult> {
  const token = await obterToken(c, SICOOB_SCOPE_CONSULTAR_BOLETO)
  const qs = new URLSearchParams({
    numeroCliente: String(c.codigo_beneficiario),
    codigoModalidade: String(codigoModalidade),
    nossoNumero: String(nossoNumero),
  }).toString()
  const res = await request<unknown>({
    host: API_HOST[c.ambiente],
    path: `/cobranca-bancaria/v3/boletos?${qs}`,
    method: 'GET',
    headers: {
      'authorization': `Bearer ${token}`,
      'client_id': c.client_id,
    },
    pfx: c.pfx, passphrase: c.passphrase,
  })
  if (res.status < 200 || res.status >= 300) {
    return { status: res.status, situacao: null, dataLiquidacao: null, valorPago: null, raw: res.body }
  }
  // Sicoob V3 retorna { resultado: { ... } } ou o objeto direto.
  const envelope = res.body as { resultado?: Record<string, unknown> } | null
  const dataObj = (envelope?.resultado ?? (res.body as Record<string, unknown> | null) ?? {}) as Record<string, unknown>
  // Sicoob usa 'situacaoBoleto' na maioria dos ambientes; fallbacks
  // pra 'situacao'/'statusBoleto' (varia entre versoes).
  const situacaoRaw = (dataObj.situacaoBoleto ?? dataObj.situacao ?? dataObj.statusBoleto) as string | undefined
  const situacao = situacaoRaw ? String(situacaoRaw).toUpperCase() : null
  const dataLiquidacao = (dataObj.dataLiquidacao ?? dataObj.dataPagamento) as string | undefined ?? null
  const valorPagoRaw = (dataObj.valorPago ?? dataObj.valorRecebido) as number | string | undefined
  const valorPago = typeof valorPagoRaw === 'number' ? valorPagoRaw
    : typeof valorPagoRaw === 'string' ? Number(valorPagoRaw) : null
  return { status: res.status, situacao, dataLiquidacao, valorPago, raw: res.body }
}
