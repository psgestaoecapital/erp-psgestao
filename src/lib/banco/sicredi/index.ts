// Sicredi Cobrança API v1 (REST direto) — espelha o adapter Sicoob, MAS:
//  - Auth = OAuth2 client_credentials (client_id + client_secret no corpo), SEM mTLS/pfx.
//  - Cobrança exige headers x-api-key + Authorization Bearer + context: COBRANCA.
//  - Banco código 748. Reusa gerarPdfBoleto (agnóstico) — o PDF é gerado localmente.
// Node runtime (usa fetch global do Node 18+). Segredos SÓ do Vault (nunca em código/log).
//
// ⚠️ TESTE REAL espera credenciais no Vault (client_id/secret + x-api-key + codigo_beneficiario).
//    Campos do payload marcados com TODO(confirmar-doc) devem ser validados na doc autenticada
//    do portal Sicredi antes do 1º registro em produção.

export type SicrediAmbiente = 'producao' | 'homologacao'

// Host base. Produção confirmada. Homologação: Sicredi usa o mesmo host com credenciais
// de sandbox na maioria dos apps — TODO(confirmar-doc) o host de homologação no gerente.
const API_HOST: Record<SicrediAmbiente, string> = {
  producao: 'api-parceiro.sicredi.com.br',
  homologacao: 'api-parceiro.sicredi.com.br',
}
const AUTH_PATH = '/auth/openapi/token'
const BOLETO_PATH = '/cobranca/boleto/v1/boletos'

export type Credencial = {
  client_id: string
  client_secret: string
  api_key: string
  ambiente: SicrediAmbiente
  codigo_beneficiario: string
  cooperativa: string
  conta: string
  agencia: string | null
  convenio: string | null
  carteira: string | null
  juros_pct?: number | null
  multa_pct?: number | null
}

type TokenCacheEntry = { access_token: string; expires_at: number }
const tokenCache = new Map<string, TokenCacheEntry>()

function baseUrl(amb: SicrediAmbiente): string {
  return `https://${API_HOST[amb]}`
}

export async function obterToken(c: Credencial): Promise<string> {
  const key = `${c.client_id}:${c.ambiente}`
  const hit = tokenCache.get(key)
  if (hit && hit.expires_at > Date.now()) return hit.access_token

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: c.client_id,
    client_secret: c.client_secret,
    scope: 'cobranca',
  }).toString()

  const res = await fetch(baseUrl(c.ambiente) + AUTH_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-api-key': c.api_key,
      accept: 'application/json',
    },
    body,
  })
  const raw = await res.text()
  let parsed: { access_token?: string; expires_in?: number } = {}
  try { parsed = raw ? JSON.parse(raw) : {} } catch { /* keep raw */ }
  if (!res.ok || !parsed.access_token) {
    throw new Error(`Sicredi auth falhou: ${res.status} ${raw.slice(0, 300)}`)
  }
  const ttlMs = Math.max(60, (parsed.expires_in ?? 3600) - 60) * 1000
  tokenCache.set(key, { access_token: parsed.access_token, expires_at: Date.now() + ttlMs })
  return parsed.access_token
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
  hibrido?: boolean               // boleto + Pix
  especieDocumento?: string       // default 'DUPLICATA_MERCANTIL_INDICACAO'
  mensagens?: Array<string | null | undefined>
}

export type RegistroResult = {
  status: number
  nuTituloGerado?: string          // nossoNumero
  linhaDigitavel?: string
  codigoBarras?: string
  qrCode?: string                  // pixCopiaECola
  txid?: string
  raw: unknown
  payload_resumo?: Record<string, unknown>
}

// POST cobrança/boleto/v1/boletos. TODO(confirmar-doc): nomes exatos dos campos do
// schema Sicredi v1 (tipoCobranca, pagador.*, especieDocumento) — estrutura montada
// conforme a doc pública; validar no portal autenticado antes de produção.
export async function registrarBoleto(input: RegistrarBoletoInput): Promise<RegistroResult> {
  const c = input.cred
  const token = await obterToken(c)
  const doc = onlyDigits(input.pagador.documento)

  const payload: Record<string, unknown> = {
    tipoCobranca: input.hibrido === false ? 'NORMAL' : 'HIBRIDO', // HIBRIDO = boleto + Pix
    codigoBeneficiario: c.codigo_beneficiario,
    especieDocumento: input.especieDocumento ?? 'DUPLICATA_MERCANTIL_INDICACAO',
    seuNumero: input.seuNumero.slice(0, 25),
    dataVencimento: input.vencimentoISO,
    valor: Number(input.valor.toFixed(2)),
    pagador: {
      tipoPessoa: input.pagador.tipo === 'PF' ? 'PESSOA_FISICA' : 'PESSOA_JURIDICA',
      documento: doc,
      nome: cleanText(input.pagador.nome, 70),
      endereco: cleanText(input.pagador.logradouro ?? '', 40),
      bairro: cleanText(input.pagador.bairro ?? '', 40),
      cidade: cleanText(input.pagador.cidade ?? '', 30),
      uf: cleanText(input.pagador.uf ?? '', 2).toUpperCase(),
      cep: onlyDigits(input.pagador.cep ?? ''),
    },
  }
  if (c.juros_pct && c.juros_pct > 0) {
    payload.juros = { tipo: 'PERCENTUAL', valor: Number(c.juros_pct) } // TODO(confirmar-doc)
  }
  if (c.multa_pct && c.multa_pct > 0) {
    payload.multa = { tipo: 'PERCENTUAL', valor: Number(c.multa_pct) } // TODO(confirmar-doc)
  }
  if (input.mensagens && input.mensagens.length > 0) {
    payload.informativos = input.mensagens
      .filter((m): m is string => !!m && m.trim().length > 0)
      .slice(0, 5).map((m) => cleanText(m, 80))
  }

  const res = await fetch(baseUrl(c.ambiente) + BOLETO_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-api-key': c.api_key,
      authorization: `Bearer ${token}`,
      context: 'COBRANCA',
    },
    body: JSON.stringify(payload),
  })
  const raw = await res.text()
  let data: Record<string, unknown> | null = null
  try { data = raw ? JSON.parse(raw) : null } catch { /* keep raw */ }

  const resumo: Record<string, unknown> = { ...payload }
  const pag = resumo.pagador as Record<string, unknown> | undefined
  if (pag && typeof pag.documento === 'string') {
    pag.documento = (pag.documento as string).replace(/^(\d{3})(\d+)(\d{2})$/, '$1***$3')
  }
  resumo._endpoint = baseUrl(c.ambiente) + BOLETO_PATH

  if (!res.ok) {
    return { status: res.status, raw: data ?? raw, payload_resumo: resumo }
  }
  const d = (data?.boleto as Record<string, unknown> | undefined) ?? data ?? {}
  return {
    status: res.status,
    nuTituloGerado: (d.nossoNumero as string | number | undefined)?.toString(),
    linhaDigitavel: (d.linhaDigitavel ?? d.linha_digitavel) as string | undefined,
    codigoBarras: (d.codigoBarras ?? d.codigo_barras) as string | undefined,
    qrCode: (d.pixCopiaECola ?? d.qrCode ?? d.textoPix) as string | undefined,
    txid: (d.txid) as string | undefined,
    raw: data ?? raw,
    payload_resumo: resumo,
  }
}

export type ConsultaBoletoResult = {
  status: number
  situacao: string | null
  dataLiquidacao: string | null
  valorPago: number | null
  raw: unknown
}

// GET consulta situação do boleto. TODO(confirmar-doc) o path/campos exatos.
export async function consultarBoleto(c: Credencial, nossoNumero: string | number): Promise<ConsultaBoletoResult> {
  const token = await obterToken(c)
  const qs = new URLSearchParams({
    codigoBeneficiario: c.codigo_beneficiario,
    nossoNumero: String(nossoNumero),
  }).toString()
  const res = await fetch(`${baseUrl(c.ambiente)}${BOLETO_PATH}?${qs}`, {
    headers: { accept: 'application/json', 'x-api-key': c.api_key, authorization: `Bearer ${token}`, context: 'COBRANCA' },
  })
  const raw = await res.text()
  let d: Record<string, unknown> = {}
  try { d = raw ? JSON.parse(raw) : {} } catch { /* keep */ }
  if (!res.ok) return { status: res.status, situacao: null, dataLiquidacao: null, valorPago: null, raw: d || raw }
  const obj = (d.boleto as Record<string, unknown> | undefined) ?? d
  const sit = (obj.situacao ?? obj.status) as string | undefined
  const valorPagoRaw = (obj.valorLiquidado ?? obj.valorPago) as number | string | undefined
  return {
    status: res.status,
    situacao: sit ? String(sit).toUpperCase() : null,
    dataLiquidacao: (obj.dataLiquidacao ?? obj.dataPagamento) as string | undefined ?? null,
    valorPago: typeof valorPagoRaw === 'number' ? valorPagoRaw : typeof valorPagoRaw === 'string' ? Number(valorPagoRaw) : null,
    raw: d,
  }
}
