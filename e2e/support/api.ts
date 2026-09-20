// Revenda R1b · suporte às jornadas: ambiente, DB via service_role (asserção no banco) e sessão do bot.
// Nunca usar em produção de cliente — só a empresa de DEMONSTRAÇÃO (is_demo). O service_role fica no
// runner (GitHub Actions secrets), jamais no navegador.

import { createClient } from '@supabase/supabase-js'

export const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'

export const BASE_URL = process.env.PROD_BASE_URL || 'https://erp-psgestao.vercel.app'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
export const BOT_EMAIL = process.env.PLAYWRIGHT_USER_EMAIL || ''
export const BOT_PASSWORD = process.env.PLAYWRIGHT_USER_PASSWORD || ''

export function exigirEnv(): void {
  const faltando = [
    ['SUPABASE_URL', SUPABASE_URL], ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON_KEY],
    ['PLAYWRIGHT_USER_EMAIL', BOT_EMAIL], ['PLAYWRIGHT_USER_PASSWORD', BOT_PASSWORD],
  ].filter(([, v]) => !v).map(([k]) => k)
  if (faltando.length) throw new Error('Faltam variáveis de ambiente: ' + faltando.join(', '))
}

export function projectRef(): string {
  return SUPABASE_URL.replace('https://', '').split('.')[0]
}
export function storageKey(): string {
  return `sb-${projectRef()}-auth-token`
}

// ── DB via service_role (só asserção/preparo de estado, sempre na empresa demo) ──────────────────────
const rest = () => ({
  url: SUPABASE_URL,
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  } as Record<string, string>,
})

export async function dbSelect<T = Record<string, unknown>>(
  tabela: string, query: string,
): Promise<T[]> {
  const { url, headers } = rest()
  const resp = await fetch(`${url}/rest/v1/${tabela}?${query}`, { headers })
  if (!resp.ok) throw new Error(`select ${tabela} falhou: ${resp.status} ${await resp.text()}`)
  return (await resp.json()) as T[]
}

export async function dbPatch(tabela: string, query: string, body: Record<string, unknown>): Promise<void> {
  const { url, headers } = rest()
  const resp = await fetch(`${url}/rest/v1/${tabela}?${query}`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`patch ${tabela} falhou: ${resp.status} ${await resp.text()}`)
}

export async function dbDelete(tabela: string, query: string): Promise<void> {
  const { url, headers } = rest()
  const resp = await fetch(`${url}/rest/v1/${tabela}?${query}`, {
    method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' },
  })
  if (!resp.ok) throw new Error(`delete ${tabela} falhou: ${resp.status} ${await resp.text()}`)
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { url, headers } = rest()
  const resp = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  })
  if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
  return (await resp.json()) as T
}

// Reset da demo ao FIM da suíte (a demo pode ser mexida à vontade e volta ao seed).
export async function resetarDemo(): Promise<void> {
  await rpc('fn_demo_reset', { p_company_id: DEMO_REVENDA })
}

// R1 item 1c · grava o resultado da jornada (verde/vermelho) em gold_jornada_resultado. A jornada VERDE
// prova o requisito mapeado (jornada_requisito) e prevalece sobre a foto do juiz (fn_blueprint_cobertura).
// Nunca lança: o registro é observabilidade, não pode derrubar a suíte.
export async function registrarJornada(jornada: string, status: 'verde' | 'vermelho', detalhe?: string): Promise<void> {
  try {
    await rpc('fn_jornada_registrar_resultado', {
      p_jornada: jornada, p_status: status, p_detalhe: detalhe ?? null, p_vertical: 'revenda_veiculos',
    })
  } catch (e) {
    console.error(`[jornada ${jornada}] não gravou resultado (${status}):`, e instanceof Error ? e.message : String(e))
  }
}

// id do veículo da demo pelo modelo (robusto a mudança de id).
export async function veiculoIdPorModelo(modelo: string): Promise<string> {
  const rows = await dbSelect<{ id: string }>('veic_veiculo',
    `company_id=eq.${DEMO_REVENDA}&modelo=eq.${encodeURIComponent(modelo)}&deleted_at=is.null&select=id&limit=1`)
  if (!rows.length) throw new Error(`veículo demo "${modelo}" não encontrado`)
  return rows[0].id
}

// ── Sessão do bot (mesmo login real da tela) → payload p/ localStorage sb-<ref>-auth-token ────────────
export async function obterSessionPayload(): Promise<string> {
  const authClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await authClient.auth.signInWithPassword({ email: BOT_EMAIL, password: BOT_PASSWORD })
  if (error || !data?.session) throw new Error(`login do bot falhou: ${error?.message || 'sem session'}`)
  const s = data.session
  return JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in,
    expires_at: s.expires_at, token_type: s.token_type, user: s.user,
    provider_token: null, provider_refresh_token: null,
  })
}
