'use client'

// Papel do usuário logado (users.role). Usado para filtro FINO de vista dentro de um módulo por papel —
// ex.: o RH industrial (role 'rh_industrial') vê só o recorte Gente do BI, não Produção. Genérico por
// PAPEL (não por usuário/empresa): qualquer RH industrial herda o mesmo comportamento.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export function usePapelUsuario(): { papel: string | null; resolvido: boolean } {
  const [papel, setPapel] = useState<string | null>(null)
  const [resolvido, setResolvido] = useState(false)
  useEffect(() => {
    let alive = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (alive) { setPapel(null); setResolvido(true) } return }
      const { data } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
      if (alive) { setPapel((data as { role?: string | null } | null)?.role ?? null); setResolvido(true) }
    })()
    return () => { alive = false }
  }, [])
  return { papel, resolvido }
}

/** RH industrial: vê Gente do BI, nunca Produção/Abate. Regra por papel. */
export const ehRhIndustrial = (papel: string | null) => papel === 'rh_industrial'
