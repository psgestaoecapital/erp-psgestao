import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Cliente admin (service role) — usar APENAS em Server Components e API Routes, nunca no cliente.
//
// LAZY (17/09/2026 · build vermelho da main): antes o createClient rodava no MÓDULO — e o
// `next build` (Next 16, "Collecting page data") avalia o módulo de cada rota. Como o
// SUPABASE_SERVICE_ROLE_KEY é secret e o Vercel NÃO expõe secrets ao passo de build, a coleta
// estourava "supabaseUrl is required" assim que o cache de coleta era invalidado (foi o que o #1526
// disparou ao mexer num componente importado por muitas páginas). Adiando o createClient para o
// primeiro uso (runtime, onde o secret existe), o build nunca precisa do env — imune de vez.
let _client: SupabaseClient | null = null
function getAdmin(): SupabaseClient {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase admin não configurado (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes)')
  }
  _client = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  return _client
}

// Proxy: mantém a API `supabaseAdmin.from(...)` idêntica, mas só cria o client no 1º acesso (runtime).
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getAdmin()
    const value = Reflect.get(client as object, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
