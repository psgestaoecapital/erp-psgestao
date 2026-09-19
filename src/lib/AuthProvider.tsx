'use client'
import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, EVENTO_SESSAO_SUSPEITA } from '@/lib/supabase'
import { comPrazo } from '@/lib/comPrazo'
import { registrarEventoAuth } from '@/lib/telemetria'

// ══════════════════════════════════════════════════════════════════════════
// SESSÃO ÚNICA + "NUNCA OPERAR COMO VISITANTE" (P0 · contexto 16bc8561 / 147694b7)
//
// Causa provada nos logs: com o app em segundo plano o celular congela os timers → o
// autoRefreshToken do supabase-js não roda → o token vence (~1h) → ao voltar, os pedidos saem SEM
// JWT (401 em fn_empresa_areas_status) e o app renderiza como VISITANTE (telas vazias), sem levar
// ao login.
//
// Correção:
//  • A sessão é lida UMA vez (getSession, storage local — sem ida ao servidor e sem disputar a trava
//    navigator.locks que travava o mobile). onAuthStateChange mantém em dia.
//  • RETOMADA (visibilitychange→visible, focus, pageshow, online): reativa o autoRefresh e, se a
//    sessão vence em < 60s ou já venceu, faz refreshSession() com prazo — para o token voltar ANTES
//    das telas dispararem RPC. Em hidden: para o autoRefresh (economia; nada a renovar oculto).
//  • GUARDA: sessão ausente/expirada, refresh falho, SIGNED_OUT, ou 401 confirmado → estado
//    'sem_sessao' → tela "Sua sessão expirou · Entrar de novo" (nunca o dashboard vazio) → /login
//    com retorno à rota atual.
//  • Telemetria tipo='auth' (fn_registrar_evento_auth, que permite anon): TOKEN_REFRESHED,
//    refresh_falhou, SIGNED_OUT, sessao_ausente — com rota, user-agent e versão do bundle.
// A autorização continua no banco (RLS/guardas); rotas /api seguem validando o token no servidor.
// ══════════════════════════════════════════════════════════════════════════

type StatusSessao = 'carregando' | 'ok' | 'sem_sessao'

interface SessaoCtx {
  user: User | null
  userId: string | null
  email: string | null
  loading: boolean
  status: StatusSessao
}

const Ctx = createContext<SessaoCtx>({ user: null, userId: null, email: null, loading: true, status: 'carregando' })

/** Hook único de sessão para componentes de TELA. Substitui supabase.auth.getUser() nas telas. */
export function useUsuario(): SessaoCtx {
  return useContext(Ctx)
}

// Sessão vence em < 60s (ou já venceu)?
function venceEmBreve(session: Session | null): boolean {
  if (!session) return true
  const expMs = (session.expires_at ?? 0) * 1000
  return expMs - Date.now() < 60_000
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<StatusSessao>('carregando')
  const refreshRef = useRef(false)   // evita refresh em paralelo

  useEffect(() => {
    let alive = true

    function aplicarSessao(s: Session | null) {
      if (!alive) return
      setSession(s)
      setStatus(s ? 'ok' : 'sem_sessao')
    }

    // Garante uma sessão VÁLIDA agora: se vence em breve/venceu, tenta refresh (com prazo).
    async function garantirSessao(motivo: string) {
      if (refreshRef.current) return
      refreshRef.current = true
      try {
        try { supabase.auth.startAutoRefresh() } catch { /* noop */ }
        const { data } = await comPrazo(() => supabase.auth.getSession(), { ms: 8000, tentativas: 1, label: `auth_getSession_${motivo}` })
        const atual = data.session ?? null
        if (!atual) { aplicarSessao(null); registrarEventoAuth('sessao_ausente'); return }
        if (!venceEmBreve(atual)) { aplicarSessao(atual); return }
        // Vencendo/vencida → tenta renovar.
        const { data: nova, error } = await comPrazo(() => supabase.auth.refreshSession(), { ms: 8000, tentativas: 1, label: `auth_refresh_${motivo}` })
        if (error || !nova?.session) { aplicarSessao(null); registrarEventoAuth('refresh_falhou') }
        else { aplicarSessao(nova.session); registrarEventoAuth('TOKEN_REFRESHED') }
      } catch {
        // Pendurou/rede: NÃO desloga por engano — reflete o que já temos em memória.
        registrarEventoAuth('refresh_falhou')
      } finally {
        refreshRef.current = false
      }
    }

    // 1ª leitura (rápida, storage local).
    void comPrazo(() => supabase.auth.getSession(), { ms: 8000, tentativas: 1, label: 'auth_getSession_inicial' })
      .then(({ data }) => {
        if (!alive) return
        const s = data.session ?? null
        if (!s) { setSession(null); setStatus('sem_sessao'); registrarEventoAuth('sessao_ausente'); return }
        // Sessão vencendo/vencida na abertura: mantém 'carregando' e renova ANTES de virar 'ok' — assim
        // as telas (que esperam status='ok') não disparam RPC com token morto (a enxurrada de 401).
        if (venceEmBreve(s)) { void garantirSessao('inicial'); return }
        aplicarSessao(s)
      })
      .catch(() => { if (alive) { setSession(null); setStatus('sem_sessao') } })

    // login/logout/refresh do supabase-js.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!alive) return
      if (event === 'SIGNED_OUT') { setSession(null); setStatus('sem_sessao'); registrarEventoAuth('SIGNED_OUT'); return }
      if (event === 'TOKEN_REFRESHED') { setSession(s ?? null); setStatus(s ? 'ok' : 'sem_sessao'); if (s) registrarEventoAuth('TOKEN_REFRESHED'); return }
      // SIGNED_IN / INITIAL_SESSION / USER_UPDATED
      setSession(s ?? null)
      setStatus(s ? 'ok' : 'sem_sessao')
    })

    // Retomada do app / foco / volta de bfcache / rede voltou → reativa refresh e valida a sessão.
    const onVisivel = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        try { supabase.auth.stopAutoRefresh() } catch { /* noop */ }
        return
      }
      void garantirSessao('retomada')
    }
    const onFocus = () => { void garantirSessao('focus') }
    const onPageShow = () => { void garantirSessao('pageshow') }
    const onOnline = () => { void garantirSessao('online') }
    const onSuspeita = () => { void garantirSessao('http401') }

    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisivel)
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus)
      window.addEventListener('pageshow', onPageShow)
      window.addEventListener('online', onOnline)
      window.addEventListener(EVENTO_SESSAO_SUSPEITA, onSuspeita)
    }

    return () => {
      alive = false
      sub.subscription.unsubscribe()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisivel)
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('pageshow', onPageShow)
        window.removeEventListener('online', onOnline)
        window.removeEventListener(EVENTO_SESSAO_SUSPEITA, onSuspeita)
      }
    }
  }, [])

  const user = session?.user ?? null
  const loading = status === 'carregando'

  return (
    <Ctx.Provider value={{ user, userId: user?.id ?? null, email: user?.email ?? null, loading, status }}>
      {status === 'sem_sessao' ? <SessaoExpirada /> : children}
    </Ctx.Provider>
  )
}

// Tela de bloqueio: NUNCA renderiza o dashboard sem sessão. Leva ao login preservando a rota atual.
function SessaoExpirada() {
  const [indo, setIndo] = useState(false)
  function entrar() {
    if (indo) return
    setIndo(true)
    try {
      const retorno = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.assign(`/login?returnTo=${retorno}`)
    } catch { try { window.location.assign('/login') } catch { /* noop */ } }
  }
  // Redireciona sozinho após um instante (o usuário também pode tocar no botão).
  useEffect(() => {
    const t = setTimeout(entrar, 2500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#FAF7F2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 380, width: '100%', background: '#FFFFFF', border: '1px solid #E0D8CC', borderRadius: 14, padding: 24, textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: '#3D2314' }}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Sua sessão expirou</div>
        <div style={{ fontSize: 13, color: '#6B5D4F', lineHeight: 1.6, marginBottom: 18 }}>
          Por segurança, entre de novo para continuar. Vamos te levar de volta para onde você estava.
        </div>
        <button type="button" onClick={entrar}
          style={{ width: '100%', background: '#C8941A', color: '#3D2314', border: 'none', borderRadius: 10, padding: '12px 16px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          Entrar de novo
        </button>
      </div>
    </div>
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
