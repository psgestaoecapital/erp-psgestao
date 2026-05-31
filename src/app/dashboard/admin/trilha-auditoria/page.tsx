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

  // FIX PR-152-sidebar: trilha de auditoria é Pilar 1 LGPD (Art. 37) —
  // contexto sidebar = Compliance. Sem ?area=, o layout cai para a P3
  // (sessionStorage) e mostra a última área visitada.
  // `admin` não é área válida em fn_areas_menu_lateral; `compliance` é.
  useEffect(() => {
    if (searchParams?.get('area') !== 'compliance') {
      const novos = new URLSearchParams(searchParams?.toString() ?? '')
      novos.set('area', 'compliance')
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
