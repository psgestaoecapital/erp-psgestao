// Bradesco Cobranca — auth mTLS + registrar boleto.
// Node runtime only (mTLS via https.Agent com .pfx).
import https from 'node:https'
import { Buffer } from 'node:buffer'

export type BradescoAmbiente = 'producao' | 'sandbox'

const HOSTS: Record<BradescoAmbiente, string> = {
  producao: 'openapi.bradesco.com.br',
  sandbox: 'openapisandbox.prebanco.com.br',
}

type TokenCacheEntry = { access_token: string; expires_at: number }
const tokenCache = new Map<string, TokenCacheEntry>()
const TOKEN_TTL_MS = 55 * 60 * 1000

export type Credencial = {
  client_id: string
  client_secret: string
  ambiente: BradescoAmbiente
  pfx: Buffer
  passphrase: string
}

type HttpResult<T> = { status: number; body: T }

function request<T = unknown>(opts: {
  host: string; path: string; method: 'GET' | 'POST'; headers?: Record<string, string>;
  body?: string; pfx: Buffer; passphrase: string;
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
        resolve({ status: res.statusCode ?? 0, body: parsed as T })
      })
    })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

export async function obterToken(c: Credencial): Promise<string> {
  const key = `${c.client_id}:${c.ambiente}`
  const hit = tokenCache.get(key)
  if (hit && hit.expires_at > Date.now()) return hit.access_token

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: c.client_id,
    client_secret: c.client_secret,
  }).toString()

  const res = await request<{ access_token?: string; error?: string; error_description?: string }>({
    host: HOSTS[c.ambiente], path: '/auth/server-mtls/v2/token', method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(body.length) },
    body, pfx: c.pfx, passphrase: c.passphrase,
  })
  if (res.status !== 200 || !res.body?.access_token) {
    throw new Error(`Bradesco auth falhou: ${res.status} ${JSON.stringify(res.body)}`)
  }
  tokenCache.set(key, { access_token: res.body.access_token, expires_at: Date.now() + TOKEN_TTL_MS })
  return res.body.access_token
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const onlyDigits = (s: string) => (s ?? '').replace(/\D/g, '')
const cleanText = (s: string | null | undefined, max = 70) =>
  stripAccents((s ?? '').trim()).replace(/[.\-\/]/g, ' ').replace(/\s+/g, ' ').slice(0, max)
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}
const fmtPct = (n: number | null | undefined) => (n == null ? '0.00' : Number(n).toFixed(2))
const fmtVal = (n: number) => n.toFixed(2)

export type RegistrarBoletoInput = {
  cred: Credencial
  cnpjBeneficiario: string  // 14 digitos da empresa
  agencia: string           // 4 digitos
  conta: string             // sem digito (7 digitos)
  carteira: string          // ex.: '09'
  convenio?: string | null  // numero do convenio Bradesco (opcional)
  codigoBeneficiario?: string | null  // codigo do beneficiario na cobranca (opcional)
  nuCliente: string         // numero do documento / id curto
  emissaoISO: string        // YYYY-MM-DD
  vencimentoISO: string     // YYYY-MM-DD
  valor: number
  pagador: {
    tipo: 'PF' | 'PJ'
    documento: string
    nome: string
    logradouro: string | null
    numero: string | null
    bairro: string | null
    cidade: string | null
    uf: string | null
    cep: string | null
  }
  jurosPct?: number | null
  multaPct?: number | null
  instrucoes?: Array<string | null | undefined>
}

export type RegistroResult = {
  status: number
  nuTituloGerado?: string
  linhaDigitavel?: string
  cdBarras?: string
  raw: unknown
  payload_resumo?: Record<string, unknown>  // payload enviado (segredos mascarados) — para diagnostico
}

export async function registrarBoleto(input: RegistrarBoletoInput): Promise<RegistroResult> {
  const token = await obterToken(input.cred)

  const cnpj = onlyDigits(input.cnpjBeneficiario)
  if (cnpj.length !== 14) throw new Error('CNPJ do beneficiario invalido')
  const nuCPFCNPJ = cnpj.slice(0, 8)
  const filialCPFCNPJ = cnpj.slice(8, 12)
  const ctrlCPFCNPJ = cnpj.slice(12)

  // CEP do pagador: a API Bradesco exige cepPagador com 5 digitos + complementoCepPagador com 3.
  // Falha amigavel ANTES de chamar o banco se o cliente nao tem CEP completo.
  const cepRaw = onlyDigits(input.pagador.cep ?? '')
  if (cepRaw.length !== 8) {
    throw new Error('Cliente sem CEP valido para emissao de boleto (esperado 8 digitos)')
  }
  const cepPagador = cepRaw.slice(0, 5)
  const complementoCepPagador = cepRaw.slice(5, 8)

  const ag = onlyDigits(input.agencia).padStart(4, '0').slice(-4)
  const ct = onlyDigits(input.conta).padStart(7, '0').slice(-7)
  const nuNegociacao = `${ag}0000000${ct}`

  const payload: Record<string, unknown> = {
    nuCPFCNPJ, filialCPFCNPJ, ctrlCPFCNPJ,
    idProduto: input.carteira,
    nuNegociacao,
    nuCliente: input.nuCliente.slice(0, 25),
    dtEmissaoTitulo: fmtDate(input.emissaoISO),
    dtVencimentoTitulo: fmtDate(input.vencimentoISO),
    vlNominalTitulo: fmtVal(input.valor),
    cdEspecieTitulo: 2,
    percentualJuros: fmtPct(input.jurosPct),
    percentualMulta: fmtPct(input.multaPct),
    nomePagador: cleanText(input.pagador.nome, 70),
    logradouroPagador: cleanText(input.pagador.logradouro ?? '', 40),
    nuLogradouroPagador: cleanText(input.pagador.numero ?? '', 10),
    bairroPagador: cleanText(input.pagador.bairro ?? '', 40),
    municipioPagador: cleanText(input.pagador.cidade ?? '', 30),
    ufPagador: cleanText(input.pagador.uf ?? '', 2).toUpperCase(),
    cepPagador,                  // 5 digitos (Bradesco rejeita >5)
    complementoCepPagador,       // 3 digitos (sufixo do CEP)
    tpVencimento: 0,
    cdIndCpfcnpjPagador: input.pagador.tipo === 'PF' ? 1 : 2,
    nuCpfcnpjPagador: onlyDigits(input.pagador.documento),
    listaMsgs: (input.instrucoes ?? [])
      .filter((m): m is string => !!m && String(m).trim().length > 0)
      .slice(0, 4)
      .map((m) => ({ mensagem: cleanText(m, 80) })),
  }
  // codigoBeneficiario e convenio sao OPCIONAIS — incluidos quando o
  // provider_config tem o valor. Algumas APIs do Bradesco resolvem o
  // contrato de cobranca via convenio+cnpj; outras exigem codigoBeneficiario
  // explicito. Enviar quando disponivel reduz risco de CBTT0004
  // "NENHUM REGISTRO FOI ENCONTRADO".
  if (input.codigoBeneficiario) payload.codigoBeneficiario = onlyDigits(input.codigoBeneficiario)
  if (input.convenio) payload.numConvenio = onlyDigits(input.convenio)

  const body = JSON.stringify(payload)
  const res = await request<{ nuTituloGerado?: string; linhaDigitavel?: string; cdBarras?: string }>({
    host: HOSTS[input.cred.ambiente],
    path: '/boleto/cobranca-registro/v1/cobranca',
    method: 'POST',
    headers: {
      // OBS: exemplo Bradesco usa token cru, sem "Bearer"
      'authorization': token,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body, pfx: input.cred.pfx, passphrase: input.cred.passphrase,
  })

  // Payload resumido para log/diagnostico: mascara CPF/CNPJ do pagador
  const mask = (s: string) => s.length <= 4 ? '****' : s.slice(0, 3) + '*'.repeat(Math.max(0, s.length - 6)) + s.slice(-3)
  const payload_resumo: Record<string, unknown> = { ...payload }
  if (typeof payload_resumo.nuCpfcnpjPagador === 'string') payload_resumo.nuCpfcnpjPagador = mask(payload_resumo.nuCpfcnpjPagador as string)
  if (typeof payload_resumo.nuCPFCNPJ === 'string') payload_resumo.nuCPFCNPJ = mask(payload_resumo.nuCPFCNPJ as string)
  payload_resumo._endpoint = `${HOSTS[input.cred.ambiente]}/boleto/cobranca-registro/v1/cobranca`

  return {
    status: res.status,
    nuTituloGerado: res.body?.nuTituloGerado,
    linhaDigitavel: res.body?.linhaDigitavel,
    cdBarras: res.body?.cdBarras,
    raw: res.body,
    payload_resumo,
  }
}
