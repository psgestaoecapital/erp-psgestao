'use client'

// RD-41 · papel de gestão do usuário na empresa (fonte canônica: fn_acesso_efetivo →
// papel_gestao, de tenant_user_roles). Usado pra gating de UI (Auxiliar = OPERATOR).
// O gating de UI é conveniência — a defesa real é no backend (RPCs não devolvem R$ a OPERATOR).
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type PapelGestao = 'CLIENT_OWNER' | 'CLIENT_MANAGER' | 'CLIENT_OPERATOR' | 'CLIENT_VIEWER' | null

export function useAcesso(companyId: string | null) {
  const [papel, setPapel] = useState<PapelGestao>(null)
  const [carregando, setCarregando] = useState<boolean>(!!companyId)

  useEffect(() => {
    if (!companyId) { setPapel(null); setCarregando(false); return }
    let alive = true
    setCarregando(true)
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!alive) return
      if (!user) { setPapel(null); setCarregando(false); return }
      const { data } = await supabase.rpc('fn_acesso_efetivo', { p_user: user.id, p_company: companyId })
      if (!alive) return
      const p = (data as { papel_gestao?: string | null } | null)?.papel_gestao ?? null
      setPapel((p as PapelGestao) ?? null)
      setCarregando(false)
    })()
    return () => { alive = false }
  }, [companyId])

  return {
    papel,
    carregando,
    isOperator: papel === 'CLIENT_OPERATOR',
    isGerencial: papel === 'CLIENT_OWNER' || papel === 'CLIENT_MANAGER',
    isViewer: papel === 'CLIENT_VIEWER',
  }
}
