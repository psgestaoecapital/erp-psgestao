'use client'

// Guia de Implantacao da Gestao Empresarial — wizard de boas-vindas
// (5 passos: contas bancarias, lancamentos, contratos, plano de contas,
// DRE divisional). Acessivel sob demanda pela sidebar "Guia de
// Implantacao"; nao aparece sozinho na home da GE (regra do produto).
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { OnboardingFiveSteps, type OnboardingData } from '@/components/ge/OnboardingFiveSteps'

type FnReturn =
  | { erro: true; mensagem: string }
  | { sem_plano: true; mensagem: string; empresa_nome: string }
  | OnboardingData

export default function GuiaImplantacaoPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [data, setData] = useState<FnReturn | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErro(null)
    void (async () => {
      const { data: result, error } = await supabase.rpc('fn_ge_onboarding_status', {
        p_company_id: empresaUnica,
      })
      if (!alive) return
      if (error) setErro(error.message)
      else setData(result as FnReturn)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [empresaUnica])

  if (loading) {
    return (
      <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: 40, color: '#3D2314' }}>
        Carregando o Guia de Implantacao…
      </div>
    )
  }
  if (erro) {
    return (
      <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: 40, color: '#A32D2D' }}>
        Nao consegui carregar o Guia de Implantacao: {erro}
      </div>
    )
  }
  if (!data || 'erro' in data) {
    return (
      <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: 40, color: '#3D2314' }}>
        Selecione uma empresa para acessar o Guia de Implantacao.
      </div>
    )
  }
  if ('sem_plano' in data && data.sem_plano) {
    return (
      <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: 40, color: '#3D2314' }}>
        {data.mensagem}
      </div>
    )
  }
  return <OnboardingFiveSteps data={data as OnboardingData} />
}
