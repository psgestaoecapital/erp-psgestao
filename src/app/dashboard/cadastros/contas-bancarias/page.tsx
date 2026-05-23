'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import ContasBancariasList from '@/components/ge/ContasBancariasList'

// Padrão da sessão: deriva empresaUnica de useCompanyIds (selInfo.companyId
// NÃO existe — selInfo é { tipo, nome, count, isGroup }). Gate por
// subscription v15_gestao_empresarial_pro ativa (RD-38).
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
        Selecione uma empresa para gerenciar contas bancárias.
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

  return <ContasBancariasList companyId={empresaUnica} />
}
