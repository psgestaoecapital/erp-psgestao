'use client'
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { comPrazo } from '@/lib/comPrazo'

// ══════════════════════════════════════════════════════════════════════════
// SESSÃO ÚNICA (P0 · Camada 2 · contexto 16bc8561)
// A sessão é lida UMA vez, do storage local via getSession() — sem ida ao servidor e sem
// disputar a trava de sessão do mobile (navigator.locks), que era o que o supabase.auth.getUser()
// fazia em ~100 telas e causava o "AbortError: Lock broken..." e o "Carregando…" eterno.
// onAuthStateChange mantém a sessão em dia (login/logout/refresh). As telas usam useUsuario()
// em vez de cada uma chamar getUser(). A autorização continua no banco (RLS/guardas) — nada muda
// em segurança; as rotas /api seguem validando o token no servidor.
// getSession() lê do storage (rápido), mas ainda pode pendurar na trava → comPrazo destrava
// fail-closed (sem sessão) sem prender o app.
// ══════════════════════════════════════════════════════════════════════════

interface SessaoCtx {
  user: User | null
  userId: string | null
  email: string | null
  loading: boolean
}

const Ctx = createContext<SessaoCtx>({ user: null, userId: null, email: null, loading: true })

/** Hook único de sessão para componentes de TELA. Substitui supabase.auth.getUser() nas telas. */
export function useUsuario(): SessaoCtx {
  return useContext(Ctx)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void comPrazo(() => supabase.auth.getSession(), { ms: 8000, tentativas: 1, label: 'sessao_getSession' })
      .then(({ data }) => { if (!alive) return; setUser(data.session?.user ?? null); setLoading(false) })
      .catch(() => { if (!alive) return; setUser(null); setLoading(false) })

    // login/logout/refresh: o evento traz a sessão nova sem novo getUser/getSession.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return
      setUser(session?.user ?? null)
      setLoading(false)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  return (
    <Ctx.Provider value={{ user, userId: user?.id ?? null, email: user?.email ?? null, loading }}>
      {children}
    </Ctx.Provider>
  )
}

// Helpers para código FORA de componente (não-hook). Usam getSession() (local, sem trava de
// servidor) no lugar de getUser(). Para validação server-side de token, use getUser() nas rotas /api.
export async function getUsuarioId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id ?? null
}
export async function getUsuarioAtual(): Promise<User | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user ?? null
}
