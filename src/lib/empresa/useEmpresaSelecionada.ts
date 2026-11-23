'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getUsuarioId } from '@/lib/AuthProvider'

// Empresa selecionada (companyId) a partir do seletor global (ps_empresa_sel) + polling — hook GENÉRICO,
// sem nada de vertical. Vivia em @/lib/agro/usePecuaria, mas o núcleo (GE › Resultado por negócio) e
// Linhas de negócio também o usam; núcleo não pode depender de uma vertical (PRINCÍPIO 1). Movido para cá;
// o caminho agro re-exporta por compatibilidade.
//
// FALLBACK PR#448: quando ps_empresa_sel é null/'consolidado'/'group_*' (caso clássico de CLIENT_OWNER que
// não usa seletor de empresa porque só tem 1), consulta user_companies e auto-seleciona se o usuário tem
// exatamente 1 empresa. Evita o estado "companyId null" eterno quando na verdade há uma empresa óbvia.
export function useEmpresaSelecionada(): { companyId: string | null } {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const readLocal = (): string | null => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    const aplicar = (v: string | null) => {
      if (!alive) return
      setCompanyId((p) => (p === v ? p : v))
    }
    aplicar(readLocal())

    // Se localStorage nao deu, tenta user_companies (auto-select 1 empresa)
    ;(async () => {
      const local = readLocal()
      if (local) return
      // Camada 2b: getUsuarioId() usa getSession (storage local) — sem getUser() disputando a trava
      // navigator.locks do mobile (causa do "Carregando…" eterno).
      const uid = await getUsuarioId()
      if (!uid) return
      const { data } = await supabase
        .from('user_companies')
        .select('company_id')
        .eq('user_id', uid)
        .limit(2)
      if (!alive) return
      if (data && data.length === 1) aplicar((data[0] as { company_id: string }).company_id)
    })()

    const t = setInterval(() => {
      const v = readLocal()
      if (v) aplicar(v) // so promove se voltou valor valido — preserva auto-seleted
    }, 800)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return { companyId }
}
