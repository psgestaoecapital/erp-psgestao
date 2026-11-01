// Banco do Brasil · Cobrança v2 (boleto) — chamado #5404 (FC Pisos), parte (b). Node runtime only.
// Sem mTLS para registrar/consultar/baixar (o certificado só é exigido em funções como webhook).
// Auth: OAuth2 client_credentials (escopos cobrancas.boletos-info + cobrancas.boletos-requisicao) + gw-dev-app-key.
//  - registrar: POST /cobrancas/v2/boletos
//  - consultar: GET  /cobrancas/v2/boletos/{id}?numeroConvenio=...
//  - baixar:    POST /cobrancas/v2/boletos/{id}/baixar
// As funções puras (montar/normalizar) são provadas em scripts/gates/check-bb-cobranca.ts; o sandbox do BB
// valida o contrato real (campos de homologação vêm da Jordana, não ficam em código).
import { Buffer } from 'node:buffer'
import { bbRequest, obterToken, BB_HOSTS, BB_SCOPE_COBRANCA, type BbCredencial, type BbHttp } from '@/lib/banco/bb'
import { onlyDigitsDoc } from '@/lib/banco/documento'
import { montarCorpoRegistroBb, type RegistrarBbInput } from '@/lib/banco/bb/cobrancaPura'

export * from '@/lib/banco/bb/cobrancaPura'

export type RegistroBb = {
  status: number
  nossoNumero?: string
  linhaDigitavel?: string
  codigoBarras?: string
  qrCode?: string
  txid?: string
  raw: string
  corpo_enviado?: Record<string, unknown>
}

const caminho = (c: BbCredencial, sufixo: string, extra = '') =>
  `/cobrancas/v2/boletos${sufixo}?gw-dev-app-key=${encodeURIComponent(c.app_key.trim())}${extra}`

async function chamar(c: BbCredencial, method: 'GET' | 'POST', sufixo: string, extra: string, corpo?: unknown): Promise<BbHttp> {
  const token = await obterToken(c, BB_SCOPE_COBRANCA)
  const body = corpo === undefined ? undefined : JSON.stringify(corpo)
  return bbRequest({
    host: BB_HOSTS[c.ambiente].cobranca, path: caminho(c, sufixo, extra), method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}),
    },
    body,
  })
}

export async function registrarBoletoBb(c: BbCredencial, i: RegistrarBbInput): Promise<RegistroBb> {
  const corpo = montarCorpoRegistroBb(i)
  const res = await chamar(c, 'POST', '', '', corpo)
  const j = (res.body ?? {}) as { numero?: string; linhaDigitavel?: string; codigoBarraNumerico?: string; qrCode?: { emv?: string; txId?: string; url?: string } }
  return {
    status: res.status, raw: res.raw, corpo_enviado: corpo,
    nossoNumero: j.numero, linhaDigitavel: j.linhaDigitavel, codigoBarras: j.codigoBarraNumerico,
    qrCode: j.qrCode?.emv, txid: j.qrCode?.txId,
  }
}

// codigoEstadoTituloCobranca: 1 normal · 6 liquidado · 7 baixado (demais = cartório/protesto)
export type ConsultaBb = { status: number; estado?: number; liquidado: boolean; baixado: boolean; valorPago?: number; dataPagamento?: string; raw: string }

export async function consultarBoletoBb(c: BbCredencial, nossoNumero: string, convenio: string): Promise<ConsultaBb> {
  const res = await chamar(c, 'GET', `/${encodeURIComponent(nossoNumero)}`, `&numeroConvenio=${onlyDigitsDoc(convenio)}`)
  const j = (res.body ?? {}) as { codigoEstadoTituloCobranca?: number; valorPagoSacado?: number; dataRecebimentoTitulo?: string }
  const estado = typeof j.codigoEstadoTituloCobranca === 'number' ? j.codigoEstadoTituloCobranca : undefined
  return { status: res.status, estado, liquidado: estado === 6, baixado: estado === 7, valorPago: j.valorPagoSacado, dataPagamento: j.dataRecebimentoTitulo, raw: res.raw }
}

export async function baixarBoletoBb(c: BbCredencial, nossoNumero: string, convenio: string): Promise<{ status: number; raw: string }> {
  const res = await chamar(c, 'POST', `/${encodeURIComponent(nossoNumero)}/baixar`, '', { numeroConvenio: Number(onlyDigitsDoc(convenio)) })
  return { status: res.status, raw: res.raw }
}
