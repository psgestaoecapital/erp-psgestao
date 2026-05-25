'use client'

import { useCompanyIds } from '@/lib/useCompanyIds'
import HistoricoAtividadesAdmin from '@/components/lgpd/HistoricoAtividadesAdmin'

export default function Page() {
  // Padrão da sessão (PRs #143/#147/#149/#150): destructuring correto.
  // selInfo NÃO tem campo companyId — derivar empresaUnica manualmente.
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

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
