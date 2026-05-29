'use client'

import { useRouter } from 'next/navigation'
import { useCompanyIds } from '@/lib/useCompanyIds'
import ContratosList from '@/components/ge/ContratosList'

export default function Page() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  if (!empresaUnica) {
    return (
      <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh' }}>
        <p style={{ color: '#3D2314' }}>Selecione uma empresa para gerenciar cobranças recorrentes.</p>
      </div>
    )
  }

  return (
    <>
      <div style={{ background: '#FAF7F2', padding: '20px 24px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <button
            type="button"
            onClick={() => router.push('/dashboard/cadastros/contratos-recorrentes/a-faturar')}
            style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '12px 22px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 1px 3px rgba(61,35,20,0.12)' }}
          >
            📋 Contratos a Faturar (próximos 15 dias)
          </button>
        </div>
      </div>
      <ContratosList companyId={empresaUnica} />
    </>
  )
}
