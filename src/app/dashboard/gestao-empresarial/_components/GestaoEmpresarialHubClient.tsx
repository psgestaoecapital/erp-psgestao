'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import { GestaoEmpresarialHubSkeleton } from './GestaoEmpresarialHubSkeleton'
import { ModuleCard, type ModuloHub } from './ModuleCard'

interface HubData {
  empty_state: boolean
  mensagem?: string
  empresa_id?: string
  empresa_nome?: string
  area_titulo?: string
  area_descricao?: string
  kpis?: {
    total_modulos: number
    modulos_prontos: number
    modulos_em_construcao: number
    modulos_previstos: number
    pct_evolucao_media: number
    registros_fluxo: number
    registros_dre: number
    registros_financiamentos: number
    registros_pagar: number
    registros_receber: number
  }
  cards_modulos?: ModuloHub[]
  plano_nome?: string
  plano_valor_mensal?: number
  status_comercial?: string
}

// O RPC fn_gestao_empresarial_hub_kpis opera por empresa única (p_company_id
// uuid). Consolidado/grupo → null → o próprio RPC devolve o empty_state.
export default function GestaoEmpresarialHubClient() {
  const { companyIds, selInfo } = useCompanyIds()
  const [data, setData] = useState<HubData | null>(null)
  const [loading, setLoading] = useState(true)

  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  // useCompanyIds recria o array a cada render — estabiliza pelo CSV ordenado.
  const companyIdsKey = useMemo(
    () => [...(companyIds ?? [])].sort().join(','),
    [companyIds],
  )

  useEffect(() => {
    let ignore = false
    ;(async () => {
      setLoading(true)
      const { data: result, error } = await supabase.rpc(
        'fn_gestao_empresarial_hub_kpis',
        { p_company_id: empresaUnica },
      )
      if (ignore) return
      if (error) {
        console.error('[GestaoEmpresarial] erro RPC:', error.message)
        setData(null)
      } else {
        setData(result as HubData)
      }
      setLoading(false)
    })()
    return () => {
      ignore = true
    }
    // companyIdsKey cobre a mudança de seleção; empresaUnica é derivado dela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIdsKey])

  if (loading) return <GestaoEmpresarialHubSkeleton />
  if (!data) return null

  if (data.empty_state) {
    return (
      <div style={{ backgroundColor: PSGC_COLORS.offWhite, minHeight: '100vh' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <Building2 size={64} color={PSGC_COLORS.dourado} style={{ opacity: 0.4, marginBottom: 16 }} />
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: PSGC_COLORS.espresso, margin: '0 0 8px' }}>
            Gestão Empresarial Pró
          </h2>
          <p style={{ color: PSGC_COLORS.espressoLight, maxWidth: 420, margin: 0, fontSize: 14 }}>
            {data.mensagem || 'Selecione uma empresa para acessar a Gestão Empresarial.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: PSGC_COLORS.offWhite, minHeight: '100vh', color: PSGC_COLORS.espresso }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
        {/* Cabeçalho */}
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: PSGC_COLORS.dourado, margin: 0 }}>
              Gestão Empresarial
            </p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>
              {data.area_titulo}
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: PSGC_COLORS.espressoLight, maxWidth: 640 }}>
              {data.area_descricao}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: PSGC_COLORS.espressoLight }}>
              Plano comercial · V1.5
            </div>
            <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: PSGC_COLORS.espresso }}>
              {data.plano_nome}
            </div>
            <div style={{ fontSize: 13, color: PSGC_COLORS.espressoLight }}>
              R$ {data.plano_valor_mensal?.toFixed(2)}/mês ·{' '}
              <span style={{ textTransform: 'uppercase', color: PSGC_COLORS.dourado, fontWeight: 600 }}>
                {data.status_comercial}
              </span>
            </div>
          </div>
        </header>

        {/* KPIs sumários */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 40 }}>
          <PSGCMetric label="Módulos totais" valor={data.kpis?.total_modulos ?? 0} icon="📦" />
          <PSGCMetric label="Em construção" valor={data.kpis?.modulos_em_construcao ?? 0} icon="🛠️" cor={PSGC_COLORS.dourado} destaque />
          <PSGCMetric label="Previstos" valor={data.kpis?.modulos_previstos ?? 0} icon="🗺️" />
          <PSGCMetric label="Evolução média" valor={`${data.kpis?.pct_evolucao_media ?? 0}%`} icon="📈" />
        </section>

        {/* Cards de módulos */}
        <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: PSGC_COLORS.espressoLight, margin: '0 0 12px' }}>
          Módulos da área
        </h2>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {data.cards_modulos?.map((mod) => (
            <ModuleCard key={mod.id} modulo={mod} />
          ))}
        </section>

        {/* Rodapé — base operacional */}
        <div style={{ marginTop: 48, paddingTop: 24, borderTop: `1px solid ${PSGC_COLORS.offWhiteDarker}` }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: PSGC_COLORS.espressoLight, margin: '0 0 16px' }}>
            Base operacional ({data.empresa_nome})
          </h2>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <PSGCMetric label="Fluxo realizado" valor={(data.kpis?.registros_fluxo ?? 0).toLocaleString('pt-BR')} pequeno />
            <PSGCMetric label="DRE divisional" valor={(data.kpis?.registros_dre ?? 0).toLocaleString('pt-BR')} pequeno />
            <PSGCMetric label="Financiamentos" valor={(data.kpis?.registros_financiamentos ?? 0).toLocaleString('pt-BR')} pequeno />
            <PSGCMetric label="Contas a pagar" valor={(data.kpis?.registros_pagar ?? 0).toLocaleString('pt-BR')} pequeno />
            <PSGCMetric label="Contas a receber" valor={(data.kpis?.registros_receber ?? 0).toLocaleString('pt-BR')} pequeno />
          </section>
        </div>
      </div>
    </div>
  )
}
