import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY não configurados')
}

// P0 · "nunca operar como visitante" (contexto 16bc8561): quando o token vence em segundo plano, os
// pedidos saem SEM JWT e voltam 401 (ex.: fn_empresa_areas_status deu 401 no celular do CEO). Este
// evento é um SINAL SUAVE — o AuthProvider é quem decide (confere a sessão; tenta refresh; só então
// marca "sessão expirada"). Nunca desloga por um 401 isolado. Não lê o corpo (custo zero, sem consumir
// o stream): status 401 já cobre "JWT expired"/PGRST301 do PostgREST.
export const EVENTO_SESSAO_SUSPEITA = 'ps:sessao-suspeita'
function sinalizarSessaoSuspeita(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_SUSPEITA))
  } catch { /* nunca quebra o fetch */ }
}
const fetchComGuarda: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  try { if (res.status === 401) sinalizarSessaoSuspeita() } catch { /* noop */ }
  return res
}

// ══════════════════════════════════════════════════════════════════════════
// CLIENTE ÚNICO DE NAVEGADOR (P0 · Camada 3 · contexto 16bc8561)
// Este é o ÚNICO GoTrueClient do browser. Toda tela importa ESTE singleton.
// Por quê: cada createClient com persistSession cria um GoTrueClient que sincroniza
// o refresh de sessão via navigator.locks (nome sb-<ref>-auth-token). Vários clientes
// na MESMA aba disputam a MESMA trava; quando um segura além de lockAcquireTimeout (5s
// no supabase-js 2.105.1) o outro "rouba" a trava → "AbortError: Lock broken by another
// request with the 'steal' option" e o "Carregando…" eterno do celular.
// Antes, admin/projeto e admin/sync-status criavam clientes EXTRAS — agora importam este.
//
// Trava: mantemos o navigatorLock padrão (browser). É a escolha certa para sincronizar
// refresh entre abas; seu timeout de 5s + recuperação por "steal" é justamente o
// quebra-deadlock. NÃO trocamos para processLock (é para ambientes não-browser: Node/Deno)
// nem para lockNoOp (removeria a sincronização entre abas e abriria corrida de refresh).
// A causa real era a MULTIPLICIDADE de clientes, resolvida aqui. Camadas 1 e 2 (comPrazo +
// getSession no lugar de getUser) evitam segurar a trava por muito tempo.
// storageKey fica no padrão de propósito: mudá-lo deslogaria todas as sessões vigentes.
// ══════════════════════════════════════════════════════════════════════════
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  // Interceptor de 401 (P0): sinaliza sessão suspeita para o AuthProvider verificar/refazer o login.
  global: { fetch: fetchComGuarda },
})
