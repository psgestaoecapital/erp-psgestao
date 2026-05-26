'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import LinhasNegocioList from '@/components/ge/LinhasNegocioList'

// Auditoria Gold detectou 404 em /dashboard/cadastros/divisoes (26/05/2026)
// "Divisões" é a nomenclatura preferida no Manual Vivo; "Linhas de Negócio"
// é o termo legado mantido na tabela erp_linhas_negocio. Esta rota reusa
// o mesmo componente.

export default function DivisoesPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) { setAllowed(false); return }
    ;(async () => {
      const { data } = await supabase
        .from('tenant_subscriptions')
        .select('plan_id, status')
        .eq('company_id', empresaUnica)
        .eq('status', 'active')
        .eq('plan_id', 'v15_gestao_empresarial_pro')
        .maybeSingle()
      if (!ignore) setAllowed(!!data)
    })()
    return () => { ignore = true }
  }, [empresaUnica])

  if (allowed === null) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.65)', background: '#FAF7F2', minHeight: '100vh' }}>Carregando…</div>
  }
  if (!empresaUnica) {
    return <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh', color: '#3D2314' }}>
      Selecione uma empresa para gerenciar divisões.
    </div>
  }
  if (!allowed) {
    return (
      <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh' }}>
        <h2 style={{ color: '#3D2314', fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400 }}>
          Plano Gestão Empresarial Pró necessário
        </h2>
        <p style={{ color: 'rgba(61,35,20,0.65)', marginBottom: 24 }}>
          Divisões (Linhas de Negócio) estão disponíveis no plano GE Pró.
        </p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/gestao-empresarial')}
          style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '12px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Voltar ao painel
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ background: '#FAF7F2', padding: '20px 24px 0', maxWidth: 1200, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={{ background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Painel Gestão Empresarial
        </button>
      </div>
      <LinhasNegocioList companyId={empresaUnica} />
    </div>
  )
}
