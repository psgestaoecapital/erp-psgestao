// Banco do Brasil (001) — auth OAuth2 client_credentials + gw-dev-app-key (#1736, FC Pisos).
// Node runtime only. Mesmo padrão dos adapters Sicoob/Bradesco: credenciais vêm do Vault via
// fn_banco_obter_credencial (client_id; client_secret no slot client_secret; gw-dev-app-key no slot api_key;
// certificado de comunicação, quando o BB exigir mTLS, nos slots cert/cert_senha).
//
// Portal BB Developers (developers.bb.com.br):
//  - token:    POST https://oauth.bb.com.br/oauth/token        (homologação: oauth.hm.bb.com.br)
//              Authorization: Basic base64(client_id:client_secret) · grant_type=client_credentials · scope=...
//  - APIs:     toda chamada leva ?gw-dev-app-key=<chave da aplicação>
//  - Extratos: GET /extratos/v1/conta-corrente/agencia/{agencia}/conta/{conta}
//              produção = api-extratos.bb.com.br (mTLS com o certificado da empresa); homologação = api.hm.bb.com.br
import https from 'node:https'
import { Buffer } from 'node:buffer'
import { pfxParaMtls } from '@/lib/banco/pfxMtls'

export type BbAmbiente = 'producao' | 'homologacao'

// Escopo de LEITURA do extrato — o teste de conexão usa este (nunca escopo que escreve).
export const BB_SCOPE_EXTRATO = 'extrato-info'

export const BB_HOSTS: Record<BbAmbiente, { oauth: string; extratos: string }> = {
  producao: { oauth: 'oauth.bb.com.br', extratos: 'api-extratos.bb.com.br' },
  homologacao: { oauth: 'oauth.hm.bb.com.br', extratos: 'api.hm.bb.com.br' },
}

export type BbCredencial = {
  client_id: string
  client_secret: string
  app_key: string            // gw-dev-app-key
  ambiente: BbAmbiente
  pfx?: Buffer | null        // certificado de comunicação (opcional no OAuth; exigido no extrato em produção)
  passphrase?: string | null
}

type TokenCacheEntry = { access_token: string; expires_at: number }
const tokenCache = new Map<string, TokenCacheEntry>()

export type BbHttp = { status: number; body: unknown; raw: string }

export function bbRequest(opts: {
  host: string; path: string; method: 'GET' | 'POST'
  headers?: Record<string, string>; body?: string
  pfx?: Buffer | null; passphrase?: string | null
}): Promise<BbHttp> {
  const mtls = opts.pfx && opts.pfx.length > 0 ? pfxParaMtls(opts.pfx, opts.passphrase ?? '') : {}
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: opts.host, port: 443, path: opts.path, method: opts.method,
      headers: { accept: 'application/json', ...(opts.headers ?? {}) },
      ...mtls,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        let parsed: unknown = raw
        try { parsed = raw ? JSON.parse(raw) : null } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed, raw })
      })
    })
    req.setTimeout(20_000, () => req.destroy(new Error('BB: tempo esgotado na conexão (20s)')))
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

// Diz o que falta ANTES de chamar o banco (regra 0e580f96: dizer o que falta e o que é).
export function faltasCredencialBb(c: Partial<BbCredencial>): string[] {
  const f: string[] = []
  if (!c.client_id?.trim()) f.push('Client ID')
  if (!c.client_secret?.trim()) f.push('Client Secret')
  if (!c.app_key?.trim()) f.push('Chave da aplicação (gw-dev-app-key)')
  return f
}

export async function obterToken(c: BbCredencial, scope: string = BB_SCOPE_EXTRATO): Promise<string> {
  const faltas = faltasCredencialBb(c)
  if (faltas.length) throw new Error(`BB: credencial incompleta — falta ${faltas.join(', ')}.`)
  const key = `${c.client_id}:${c.ambiente}:${scope}`
  const hit = tokenCache.get(key)
  if (hit && hit.expires_at > Date.now()) return hit.access_token

  const body = new URLSearchParams({ grant_type: 'client_credentials', scope }).toString()
  const basic = Buffer.from(`${c.client_id.trim()}:${c.client_secret.trim()}`).toString('base64')
  const res = await bbRequest({
    host: BB_HOSTS[c.ambiente].oauth, path: '/oauth/token', method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  })
  const j = (res.body ?? {}) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (res.status !== 200 || !j.access_token) {
    throw new Error(`BB auth falhou: ${res.status} ${res.raw.slice(0, 300)}`)
  }
  // expira 60s antes do informado pelo banco (padrão BB: 600s)
  const ttl = Math.max(60, (Number(j.expires_in) || 600) - 60) * 1000
  tokenCache.set(key, { access_token: j.access_token, expires_at: Date.now() + ttl })
  return j.access_token
}
