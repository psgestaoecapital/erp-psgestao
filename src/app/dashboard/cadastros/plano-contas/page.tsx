'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import PlanoContasList from '@/components/ge/PlanoContasList'

// Padrão da sessão (PRs #136/#140/#143): useCompanyIds devolve
// { companyIds[], selInfo: {tipo, nome, count, isGroup} } — sem
// `selInfo.companyId`. Empresa única = selecionar tipo 'empresa' com 1 id.
export default function Page() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [hasPlan, setHasPlan] = useState<boolean | null>(null)

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) {
      setHasPlan(null)
      return
    }
    ;(async () => {
      const { data } = await supabase
        .from('tenant_subscriptions')
        .select('id')
        .eq('company_id', empresaUnica)
        .eq('plan_id', 'v15_gestao_empresarial_pro')
        .eq('status', 'active')
        .maybeSingle()
      if (!ignore) setHasPlan(!!data)
    })()
    return () => {
      ignore = true
    }
  }, [empresaUnica])

  if (!empresaUnica) {
    return (
      <div style={{ padding: 32, color: '#A32D2D', background: '#FAF7F2', minHeight: '100vh' }}>
        Selecione uma empresa para gerenciar o plano de contas.
      </div>
    )
  }

  if (hasPlan === null) {
    return (
      <div style={{ padding: 32, color: 'rgba(61,35,20,0.55)', background: '#FAF7F2', minHeight: '100vh' }}>
        Verificando plano…
      </div>
    )
  }

  if (!hasPlan) {
    return (
      <div style={{ padding: 32, color: '#A32D2D', background: '#FAF7F2', minHeight: '100vh' }}>
        Empresa sem plano Gestão Empresarial ativo.
      </div>
    )
  }

  return <PlanoContasList companyId={empresaUnica} />
}
