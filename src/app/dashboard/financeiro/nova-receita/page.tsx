'use client'

import { useCompanyIds } from '@/lib/useCompanyIds'
import NovaReceitaForm from '@/components/financeiro/NovaReceitaForm'

export default function Page() {
  const { companyIds } = useCompanyIds()
  // Pattern useCompanyIds DEFINITIVO (PR #153 + #155):
  // selInfo NÃO tem .companyId — derivar via companyIds.length === 1.
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null

  if (!empresaUnica) {
    return (
      <div
        style={{
          padding: 32,
          color: 'rgba(61,35,20,0.7)',
          background: '#FAF7F2',
          minHeight: '100vh',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'rgba(61,35,20,0.55)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          Nova receita
        </div>
        <div style={{ fontSize: 14 }}>
          Selecione uma empresa pra cadastrar receitas (sem modo consolidado/grupo).
        </div>
      </div>
    )
  }

  return <NovaReceitaForm companyId={empresaUnica} />
}
