'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCompanyIds } from '@/lib/useCompanyIds'
import HistoricoAtividadesAdmin from '@/components/lgpd/HistoricoAtividadesAdmin'

export default function Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  // A trilha agora é surfada em gestao_empresarial/bpo (#611). NÃO forçar mais
  // 'compliance' (jogava o usuário da empresa pro contexto errado). Preserva a
  // área de onde o usuário veio; só define um default quando NÃO há ?area=.
  useEffect(() => {
    if (!searchParams?.get('area')) {
      const novos = new URLSearchParams(searchParams?.toString() ?? '')
      novos.set('area', 'gestao_empresarial')
      router.replace(`/dashboard/admin/trilha-auditoria?${novos.toString()}`)
    }
  }, [searchParams, router])

  if (!empresaUnica) {
    return (
      <div style={{ padding: 32, color: 'rgba(61,35,20,0.7)', background: '#FAF7F2', minHeight: '100vh' }}>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 1 }}>
          Histórico de Atividades
        </div>
        <div style={{ fontSize: 14 }}>
          Selecione uma empresa para consultar o histórico.
        </div>
      </div>
    )
  }

  return <HistoricoAtividadesAdmin companyId={empresaUnica} />
}
