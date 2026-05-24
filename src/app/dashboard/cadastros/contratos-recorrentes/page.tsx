'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import ContratosList from '@/components/ge/ContratosList'

export default function Page() {
  const router = useRouter()
  // Padrão da sessão (PRs #143/#144/#147): useCompanyIds devolve
  // { companyIds[], selInfo: {tipo, nome, count, isGroup} } — sem
  // selInfo.companyIds. Empresa única = tipo 'empresa' com 1 id.
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) {
      setAllowed(false)
      return
    }
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
    return (
      <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh' }}>
        <p style={{ color: '#3D2314' }}>Selecione uma empresa para gerenciar cobranças recorrentes.</p>
      </div>
    )
  }
  if (!allowed) {
    return (
      <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh' }}>
        <h2 style={{ color: '#3D2314', fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400 }}>Plano Gestão Empresarial Pró necessário</h2>
        <p style={{ color: 'rgba(61,35,20,0.65)', marginBottom: 24 }}>
          Esta funcionalidade está disponível no plano Gestão Empresarial Pró.
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

  return <ContratosList companyId={empresaUnica} />
}
