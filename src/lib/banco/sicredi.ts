// SIC-F1 · Conector Sicredi Cobrança (banco 748). Server-side apenas (service_role).
// Regras que NÃO podem ser simplificadas (Manual API Cobrança v3.9.1):
// - expires_in observado = 300 s em produção. Nunca hardcodar 1 h.
// - renovar por refresh_token (grant_type=refresh_token, SEM username/password). refresh_expires_in ≈ 1800 s.
// - x-api-key vai em TODA requisição, inclusive a de token.
// - identificação da conta vai em HEADER (cooperativa, posto, codigoBeneficiario) — webhook usa body.
// - dataVencimento = YYYY-MM-DD, nunca retroativo.
// - dataInicioJuros/dataInicioMulta DERRUBAM o QR Pix silenciosamente: não enviar quando tipoCobranca=HIBRIDO.

const HOST = 'https://api-parceiro.sicredi.com.br'
export const base = (amb: string) => (amb === 'producao' ? HOST : `${HOST}/sb`)

export type Cred = {
  api_key: string
  client_secret: string
  cooperativa: string
  posto: string
  codigo_beneficiario: string
  ambiente: string
}
type Tok = { access_token: string; refresh_token: string; exp: number; refExp: number }

const cache = new Map<string, Tok>()
const cacheKey = (c: Cred) => `${c.ambiente}:${c.cooperativa}:${c.posto}:${c.codigo_beneficiario}`

/** username = código do beneficiário + cooperativa (9 chars). Manual v3.9.1, seção 7.1, p.12. */
export const username = (c: Cred) => `${c.codigo_beneficiario}${c.cooperativa}`

export async function getToken(c: Cred): Promise<string> {
  const k = cacheKey(c)
  const now = Date.now()
  const t = cache.get(k)
  if (t && now < t.exp - 30_000) return t.access_token
  const body = new URLSearchParams(
    t && now < t.refExp - 30_000
      ? { grant_type: 'refresh_token', refresh_token: t.refresh_token }
      : { grant_type: 'password', username: username(c), password: c.client_secret, scope: 'cobranca' },
  )
  const r = await fetch(`${base(c.ambiente)}/auth/openapi/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-api-key': c.api_key,
      context: 'COBRANCA',
    },
    body,
  })
  if (!r.ok) {
    if (t) cache.delete(k) // refresh podre → derruba e tenta senha na próxima
    throw await erroSicredi(r, 'oauth')
  }
  const j = await r.json()
  cache.set(k, {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    exp: now + Number(j.expires_in) * 1000,
    refExp: now + Number(j.refresh_expires_in ?? 1800) * 1000,
  })
  return j.access_token
}

export async function headers(c: Cred, json = true): Promise<Record<string, string>> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${await getToken(c)}`,
    'x-api-key': c.api_key,
    cooperativa: c.cooperativa,
    posto: c.posto,
    codigoBeneficiario: c.codigo_beneficiario,
  }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

export type ErroSicredi = Error & { codigo: string; passo: string; http: number; raw: string }

/** Traduz a resposta do banco para o catálogo (erp_banco_erro_catalogo). Nunca devolver erro cru ao usuário. */
export async function erroSicredi(r: Response, passo: string): Promise<ErroSicredi> {
  const txt = await r.text().catch(() => '')
  const m = txt.toLowerCase()
  let codigo = `${r.status}`
  if (r.status === 401 && m.includes('x-api-key')) codigo = '401_x_api_key'
  else if (r.status === 401 && m.includes('invalid user')) codigo = '401_invalid_user_credentials'
  else if (r.status === 401 && m.includes('cooperativa')) codigo = '401_cooperativa_diferente'
  else if (r.status === 422 && m.includes('ecomm')) codigo = '422_ecomm'
  else if (r.status === 422 && m.includes('brido')) codigo = '422_hibrido'
  else if (r.status === 422 && m.includes('cep')) codigo = '422_cep_pagador'
  else if (r.status === 422 && m.includes('vencimento')) codigo = '422_vencimento_retroativo'
  else if (r.status === 422 && m.includes('encerrado')) codigo = '422_convenio_encerrado'
  else if (r.status === 400 && m.includes('seunumero')) codigo = '400_seu_numero'
  else if (r.status === 429) codigo = '429'
  const e = new Error(`sicredi_${codigo}`) as ErroSicredi
  e.codigo = codigo
  e.passo = passo
  e.http = r.status
  e.raw = txt.slice(0, 800)
  return e
}
