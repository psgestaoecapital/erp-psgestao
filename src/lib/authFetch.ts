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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers adicionais para módulos novos (BPO Admin etc) — não removem o
// contrato existente do `authFetch` acima, apenas expõem o cliente Supabase
// no browser e um wrapper amigável para chamadas RPC com mensagem humana.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o cliente Supabase do browser. Reutiliza o singleton de `./supabase`
 * para garantir uma única sessão por aba.
 */
export const supabaseBrowser = () => supabase

/**
 * Executa uma RPC (função do banco) e devolve o `data` direto. Em caso de erro
 * extrai a mensagem na ordem hint → details → message para exibir ao usuário
 * sem expor stack trace.
 */
export async function rpc<T = unknown>(
  funcao: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const { data, error } = await supabase.rpc(funcao, args as any)
  if (error) {
    const msg = error.hint || error.details || error.message || 'Erro inesperado'
    throw new Error(msg)
  }
  return data as T
}
