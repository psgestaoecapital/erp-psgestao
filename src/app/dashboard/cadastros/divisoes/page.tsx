'use client'

import { useRouter } from 'next/navigation'
import { useCompanyIds } from '@/lib/useCompanyIds'
import LinhasNegocioList from '@/components/ge/LinhasNegocioList'

export default function DivisoesPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  if (!empresaUnica) {
    return <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh', color: '#3D2314' }}>
      Selecione uma empresa para gerenciar divisões.
    </div>
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
