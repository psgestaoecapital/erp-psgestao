import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY não configurados')
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
})
