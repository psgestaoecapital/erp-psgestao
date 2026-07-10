// Sicredi · API Cobrança 4.0 (REST direto). Espelha o Sicoob MAS:
//  - Auth = grant_type=password (username/password = "Código de Acesso" gerado no
//    Internet Banking: Cobrança > Código de Acesso > Gerar). NÃO é client_credentials.
//  - access_token expira ~300s + refresh_token ~1800s — o adapter gerencia o refresh.
//  - Header x-api-key (da app no portal; diferente sandbox vs produção).
//  - Cadastro do boleto manda headers cooperativa + posto.
//  - Sandbox usa prefixo '/sb/' no host; produção sem prefixo.
//  - SEM mTLS/pfx. Banco 748. Sicredi RETORNA PDF nativo (/boletos/pdf).
// Node runtime (fetch global). Segredos SÓ do Vault (nunca em código/log).
// ⚠️ Sandbox testável já com credenciais do manual (username 123456789 / password teste123 /
//    cooperativa 6789 / posto 03 / codigoBeneficiario 12345) + a x-api-key da app de homologação.

import { Buffer } from 'node:buffer'

export type SicrediAmbiente = 'producao' | 'homologacao'

const HOST = 'api-parceiro.sicredi.com.br'
// Sandbox (homologacao) = prefixo /sb; produção sem prefixo.
function base(amb: SicrediAmbiente): string {
  return `https://${HOST}${amb === 'homologacao' ? '/sb' : ''}`
}

export type Credencial = {
  username: string           // Código de Acesso (username)
  password: string           // Código de Acesso (password)
  api_key: string
  ambiente: SicrediAmbiente
  cooperativa: string
  posto: string
  codigo_beneficiario: string
  conta: string
  agencia: string | null
  juros_pct?: number | null
  multa_pct?: number | null
}

type TokenCacheEntry = {
  access_token: string; access_expires: number
  refresh_token?: string; refresh_expires: number
}
const tokenCache = new Map<string, TokenCacheEntry>()

async function postToken(c: Credencial, form: Record<string, string>): Promise<TokenCacheEntry> {
  const res = await fetch(base(c.ambiente) + '/auth/openapi/token', {
    method: 'POST',
    // Manual Cobrança v3.9.1: header context=COBRANCA + body scope=cobranca (senão 401).
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-api-key': c.api_key, context: 'COBRANCA', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  })
  const raw = await res.text()
  let p: { access_token?: string; refresh_token?: string; expires_in?: number; refresh_expires_in?: number } = {}
  try { p = raw ? JSON.parse(raw) : {} } catch { /* keep */ }
  if (!res.ok || !p.access_token) throw new Error(`Sicredi auth falhou: ${res.status} ${raw.slice(0, 300)}`)
  const now = Date.now()
  return {
    access_token: p.access_token,
    access_expires: now + Math.max(30, (p.expires_in ?? 300) - 30) * 1000,
    refresh_token: p.refresh_token,
    refresh_expires: now + Math.max(60, (p.refresh_expires_in ?? 1800) - 60) * 1000,
  }
}

export async function obterToken(c: Credencial): Promise<string> {
  const key = `${c.username}:${c.ambiente}`
  const hit = tokenCache.get(key)
  const now = Date.now()
  if (hit && hit.access_expires > now) return hit.access_token
  // refresh se o refresh_token ainda vale; senão login completo (password grant)
  let entry: TokenCacheEntry
  if (hit?.refresh_token && hit.refresh_expires > now) {
    try {
      entry = await postToken(c, { grant_type: 'refresh_token', refresh_token: hit.refresh_token })
    } catch {
      entry = await postToken(c, { grant_type: 'password', username: c.username, password: c.password, scope: 'cobranca' })
    }
  } else {
    entry = await postToken(c, { grant_type: 'password', username: c.username, password: c.password, scope: 'cobranca' })
  }
  tokenCache.set(key, entry)
  return entry.access_token
}

const onlyDigits = (s: string) => (s ?? '').replace(/\D/g, '')
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const cleanText = (s: string | null | undefined, max = 40) =>
  stripAccents((s ?? '').trim()).replace(/\s+/g, ' ').slice(0, max)

function authHeaders(c: Credencial, token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'x-api-key': c.api_key,
    cooperativa: c.cooperativa,
    posto: c.posto,
    accept: 'application/json',
  }
}

export type PagadorInput = {
  tipo: 'PF' | 'PJ'; documento: string; nome: string
  logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null
}

export type RegistrarBoletoInput = {
  cred: Credencial
  seuNumero: string
  nossoNumero?: string
  valor: number
  emissaoISO: string
  vencimentoISO: string
  pagador: PagadorInput
  hibrido?: boolean
  especieDocumento?: string
  mensagens?: Array<string | null | undefined>
}

export type RegistroResult = {
  status: number
  nuTituloGerado?: string
  linhaDigitavel?: string
  codigoBarras?: string
  qrCode?: string
  txid?: string
  cooperativa?: string
  posto?: string
  raw: unknown
  payload_resumo?: Record<string, unknown>
}

// POST cobranca/boleto/v1/boletos. Campos conforme manual API Cobrança 4.0.
export async function registrarBoleto(input: RegistrarBoletoInput): Promise<RegistroResult> {
  const c = input.cred
  const token = await obterToken(c)
  const doc = onlyDigits(input.pagador.documento)

  const payload: Record<string, unknown> = {
    tipoCobranca: input.hibrido ? 'HIBRIDO' : 'NORMAL', // HIBRIDO exige contratação na cooperativa
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
      cidade: cleanText(input.pagador.cidade ?? '', 30),
      uf: cleanText(input.pagador.uf ?? '', 2).toUpperCase(),
      cep: onlyDigits(input.pagador.cep ?? ''),
    },
  }
  if (input.nossoNumero) payload.nossoNumero = input.nossoNumero
  if (c.juros_pct && c.juros_pct > 0) { payload.tipoJuros = 'PERCENTUAL_MES'; payload.juros = Number(c.juros_pct) }
  if (c.multa_pct && c.multa_pct > 0) { payload.tipoMulta = 'PERCENTUAL'; payload.multa = Number(c.multa_pct) }
  if (input.mensagens && input.mensagens.length > 0) {
    payload.informativos = input.mensagens.filter((m): m is string => !!m && m.trim().length > 0).slice(0, 5).map((m) => cleanText(m, 80))
  }

  const res = await fetch(base(c.ambiente) + '/cobranca/boleto/v1/boletos', {
    method: 'POST',
    headers: { ...authHeaders(c, token), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const raw = await res.text()
  let data: Record<string, unknown> | null = null
  try { data = raw ? JSON.parse(raw) : null } catch { /* keep raw */ }

  const resumo: Record<string, unknown> = { ...payload }
  const pag = resumo.pagador as Record<string, unknown> | undefined
  if (pag && typeof pag.documento === 'string') pag.documento = (pag.documento as string).replace(/^(\d{3})(\d+)(\d{2})$/, '$1***$3')
  resumo._endpoint = base(c.ambiente) + '/cobranca/boleto/v1/boletos'

  if (!res.ok) return { status: res.status, raw: data ?? raw, payload_resumo: resumo }
  const d = (data ?? {}) as Record<string, unknown>
  return {
    status: res.status,
    nuTituloGerado: (d.nossoNumero as string | number | undefined)?.toString(),
    linhaDigitavel: (d.linhaDigitavel ?? d.linha_digitavel) as string | undefined,
    codigoBarras: (d.codigoBarras ?? d.codigo_barras) as string | undefined,
    qrCode: (d.qrCode ?? d.pixCopiaECola ?? d.txtCopiaCola) as string | undefined,
    txid: d.txid as string | undefined,
    cooperativa: d.cooperativa as string | undefined,
    posto: d.posto as string | undefined,
    raw: data ?? raw,
    payload_resumo: resumo,
  }
}

export type PdfResult = { status: number; pdfBase64?: string; raw: unknown }

// GET cobranca/boleto/v1/boletos/pdf — Sicredi retorna o PDF nativo do boleto.
export async function buscarPdf(c: Credencial, nossoNumero: string | number): Promise<PdfResult> {
  const token = await obterToken(c)
  const qs = new URLSearchParams({ codigoBeneficiario: c.codigo_beneficiario, nossoNumero: String(nossoNumero) }).toString()
  const res = await fetch(`${base(c.ambiente)}/cobranca/boleto/v1/boletos/pdf?${qs}`, {
    headers: { ...authHeaders(c, token), accept: 'application/pdf' },
  })
  if (!res.ok) { const raw = await res.text(); return { status: res.status, raw } }
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/pdf') || ct.includes('octet-stream')) {
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, pdfBase64: buf.toString('base64'), raw: null }
  }
  // alguns ambientes devolvem { pdf: base64 }
  const raw = await res.text()
  let d: Record<string, unknown> = {}
  try { d = raw ? JSON.parse(raw) : {} } catch { /* keep */ }
  const pdfBase64 = (d.pdf ?? d.pdfBoleto ?? d.arquivo) as string | undefined
  return { status: res.status, pdfBase64, raw: d }
}

export type ConsultaBoletoResult = {
  status: number; situacao: string | null; dataLiquidacao: string | null; valorPago: number | null; raw: unknown
}

export async function consultarBoleto(c: Credencial, nossoNumero: string | number): Promise<ConsultaBoletoResult> {
  const token = await obterToken(c)
  const qs = new URLSearchParams({ codigoBeneficiario: c.codigo_beneficiario, nossoNumero: String(nossoNumero) }).toString()
  const res = await fetch(`${base(c.ambiente)}/cobranca/boleto/v1/boletos?${qs}`, { headers: authHeaders(c, token) })
  const raw = await res.text()
  let d: Record<string, unknown> = {}
  try { d = raw ? JSON.parse(raw) : {} } catch { /* keep */ }
  if (!res.ok) return { status: res.status, situacao: null, dataLiquidacao: null, valorPago: null, raw: d || raw }
  const obj = (Array.isArray((d as { itens?: unknown[] }).itens) ? ((d as { itens: unknown[] }).itens[0] as Record<string, unknown>) : d) ?? {}
  const sit = (obj.situacao ?? obj.status) as string | undefined
  const vRaw = (obj.valorLiquidado ?? obj.valorPago) as number | string | undefined
  return {
    status: res.status,
    situacao: sit ? String(sit).toUpperCase() : null,
    dataLiquidacao: (obj.dataLiquidacao ?? obj.dataPagamento) as string | undefined ?? null,
    valorPago: typeof vRaw === 'number' ? vRaw : typeof vRaw === 'string' ? Number(vRaw) : null,
    raw: d,
  }
}
