'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import GestaoEmpresarialHubClient from './GestaoEmpresarialHubClient'
import { GestaoEmpresarialHubSkeleton } from './GestaoEmpresarialHubSkeleton'
import { OnboardingFiveSteps, type OnboardingData } from '@/components/ge/OnboardingFiveSteps'

type FnReturn =
  | { erro: true; mensagem: string }
  | { sem_plano: true; mensagem: string; empresa_nome: string }
  | OnboardingData

// Decide entre Onboarding e o Hub atual. NÃO toca no hub atual — apenas
// gate condicional. Empty states (sem empresa / sem plano) caem no próprio
// fluxo do hub (que faz sua própria chamada e mostra as mensagens
// correspondentes via fn_gestao_empresarial_hub_kpis).
export default function GestaoEmpresarialRouter() {
  const { companyIds, selInfo } = useCompanyIds()
  const searchParams = useSearchParams()
  const skipOnboarding = searchParams?.get('skip_onboarding') === 'true'

  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [data, setData] = useState<FnReturn | null>(null)
  const [loading, setLoading] = useState(true)

  const companyIdsKey = useMemo(
    () => [...(companyIds ?? [])].sort().join(','),
    [companyIds],
  )

  useEffect(() => {
    let ignore = false
    ;(async () => {
      setLoading(true)
      const { data: result, error } = await supabase.rpc('fn_ge_onboarding_status', {
        p_company_id: empresaUnica,
      })
      if (ignore) return
      if (error) {
        console.error('[GestaoEmpresarialRouter] erro RPC:', error.message)
        setData(null)
      } else {
        setData(result as FnReturn)
      }
      setLoading(false)
    })()
    return () => {
      ignore = true
    }
    // companyIdsKey cobre a mudança de empresa; empresaUnica é derivada dela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIdsKey])

  if (loading) return <GestaoEmpresarialHubSkeleton />

  // Empresa não selecionada / não encontrada → cai no hub (empty state próprio).
  if (!data) return <GestaoEmpresarialHubClient />
  if ('erro' in data) return <GestaoEmpresarialHubClient />
  // Empresa sem subscription v15 ativa → hub renderiza seu "sem plano" via
  // fn_gestao_empresarial_hub_kpis.
  if (data.sem_plano) return <GestaoEmpresarialHubClient />

  // Empresa com plano: onboarding completo OU usuário escolheu pular → hub
  if (data.onboarding_completo || skipOnboarding) {
    return <GestaoEmpresarialHubClient />
  }

  // Onboarding incompleto → tela de boas-vindas com os 5 passos
  return <OnboardingFiveSteps data={data} />
}
