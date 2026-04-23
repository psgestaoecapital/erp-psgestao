// PS Gestão ERP — Helper para chamadas autenticadas a /api/* protegidas por
// withAuth. Pega o access_token da sessão Supabase e injeta no header.

import { supabase } from './supabase'

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const t = await token()
  const headers = new Headers(init.headers || {})
  if (t) headers.set('Authorization', `Bearer ${t}`)
  // JSON por padrão, exceto quando for FormData (browser define Content-Type).
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(input, { ...init, headers })
}
