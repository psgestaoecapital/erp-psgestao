'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Resolve a empresa atual. Lê ps_empresa_sel (canônico) com polling 800ms.
// FALLBACK (RD-52 / dívida d51bd363): quando o localStorage vem null/consolidado/group,
// busca user_companies do usuário; se ele tem EXATAMENTE UMA empresa, usa ela. Multi-empresa
// NUNCA é chutada. Alinha este hook ao resolvedor dos dados e ao fix do AreaSwitcher (#662),
// pra as telas (Agro, etc.) não receberem company=NULL e mostrarem "selecione uma empresa"
// pra um usuário single-company que já tem a empresa dele.
export function useEmpresaSelecionada(): { companyId: string | null } {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let empresasUsuario: string[] | null = null // cache do fallback (busca 1x)

    const readLocal = (): string | null => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }

    async function empresasDoUsuario(): Promise<string[]> {
      if (empresasUsuario) return empresasUsuario
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data } = await supabase.from('user_companies').select('company_id').eq('user_id', user.id)
      empresasUsuario = ((data ?? []) as { company_id: string }[]).map((r) => r.company_id).filter(Boolean)
      return empresasUsuario
    }

    async function resolver() {
      const local = readLocal()
      if (local) { if (alive) setCompanyId((prev) => (prev === local ? prev : local)); return }
      const emp = await empresasDoUsuario()
      const unica = emp.length === 1 ? emp[0] : null // só single-company usa o fallback
      if (alive) setCompanyId((prev) => (prev === unica ? prev : unica))
    }

    resolver()
    const t = setInterval(resolver, 800)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return { companyId }
}
