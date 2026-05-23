'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import GestaoEmpresarialHubClient from './GestaoEmpresarialHubClient'
import { GestaoEmpresarialHubSkeleton } from './GestaoEmpresarialHubSkeleton'
import { OnboardingFiveSteps, type OnboardingData } from '@/components/ge/OnboardingFiveSteps'
import DashboardRico from '@/components/ge/DashboardRico'

type FnReturn =
  | { erro: true; mensagem: string }
  | { sem_plano: true; mensagem: string; empresa_nome: string }
  | OnboardingData

// Decide entre Onboarding (PR 1), Dashboard Rico (PR 3) e os empty states do
// hub atual (sem empresa / sem plano). NÃO toca o hub atual — apenas gate
// condicional.
export default function GestaoEmpresarialRouter() {
  const { companyIds, selInfo } = useCompanyIds()
  const searchParams = useSearchParams()
  const skipOnboarding = searchParams?.get('skip_onboarding') === 'true'

  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [data, setData] = useState<FnReturn | null>(null)
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState<string>('Usuário')

  const companyIdsKey = useMemo(
    () => [...(companyIds ?? [])].sort().join(','),
    [companyIds],
  )

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (ignore) return
      const meta = user?.user_metadata as Record<string, unknown> | undefined
      const fullName = typeof meta?.full_name === 'string' ? (meta.full_name as string) : null
      const fallback = user?.email?.split('@')[0]
      setUserName(fullName || fallback || 'Usuário')
    })()
    return () => { ignore = true }
  }, [])

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
    return () => { ignore = true }
    // companyIdsKey cobre a mudança de empresa; empresaUnica é derivada dela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIdsKey])

  if (loading) return <GestaoEmpresarialHubSkeleton />

  // Empresa não selecionada / não encontrada → hub renderiza empty state próprio.
  if (!data) return <GestaoEmpresarialHubClient />
  if ('erro' in data) return <GestaoEmpresarialHubClient />
  if (data.sem_plano) return <GestaoEmpresarialHubClient />

  // Empresa com plano: onboarding completo OU pular → Dashboard Rico (PR 3).
  if (data.onboarding_completo || skipOnboarding) {
    return (
      <DashboardRico
        companyId={data.company_id}
        companyName={data.empresa_nome}
        userName={userName}
      />
    )
  }

  // Onboarding incompleto → tela de boas-vindas com os 5 passos.
  return <OnboardingFiveSteps data={data} />
}
