'use client'

import { useCompanyIds } from '@/lib/useCompanyIds'
import LinhasNegocioList from '@/components/ge/LinhasNegocioList'

export default function Page() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  if (!empresaUnica) {
    return (
      <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh' }}>
        <p style={{ color: '#3D2314' }}>Selecione uma empresa para gerenciar divisões.</p>
      </div>
    )
  }

  return <LinhasNegocioList companyId={empresaUnica} />
}
