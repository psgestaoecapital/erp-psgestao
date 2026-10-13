'use client'
// Selos de estado do produto ("Pronto", "Previsto", "Parcial", "Em breve") são dado interno da PS (CEO 01/10):
// só a equipe PS vê; usuário de cliente não vê selo nenhum — nem no menu, nem no título das telas.
// Equipe PS = system_role PS_ADMIN, PS_ADMIN_CVM ou PS_SUPPORT (mesma lista da Central de Melhorias).
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUsuario } from '@/lib/AuthProvider'

export const PAPEIS_EQUIPE_PS = ['PS_ADMIN', 'PS_ADMIN_CVM', 'PS_SUPPORT'] as const

export function ehEquipePS(systemRole: string | null | undefined): boolean {
  return !!systemRole && (PAPEIS_EQUIPE_PS as readonly string[]).includes(systemRole)
}

// uma consulta por usuário na sessão (o menu e as telas pedem ao mesmo tempo)
const cache = new Map<string, Promise<boolean>>()
function consultar(userId: string): Promise<boolean> {
  let p = cache.get(userId)
  if (!p) {
    p = Promise.resolve(supabase.from('users').select('system_role').eq('id', userId).maybeSingle())
      .then(({ data }) => ehEquipePS((data as { system_role?: string | null } | null)?.system_role))
      .catch(() => false)
    cache.set(userId, p)
  }
  return p
}

/** true só para a equipe PS. Enquanto carrega (ou sem login) = false: na dúvida, o selo não aparece. */
export function useEhEquipePS(): boolean {
  const { userId } = useUsuario()
  const [res, setRes] = useState<{ uid: string; ps: boolean } | null>(null)
  useEffect(() => {
    if (!userId) return
    let vivo = true
    void consultar(userId).then((ps) => { if (vivo) setRes({ uid: userId, ps }) })
    return () => { vivo = false }
  }, [userId])
  // resposta de outro usuário (troca de login) não vale: na dúvida, o selo não aparece
  return !!userId && res?.uid === userId && res.ps
}
