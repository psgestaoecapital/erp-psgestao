'use client'

import { useCompanyIds } from '@/lib/useCompanyIds'
import NovaDespesaForm from '@/components/financeiro/NovaDespesaForm'

export default function Page() {
  const { companyIds, selInfo } = useCompanyIds()
  // Bug 1 (PR #145+): useCompanyIds NÃO expõe selInfo.companyId.
  // Empresa única = tipo 'empresa' && companyIds.length === 1.
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

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
          Nova despesa
        </div>
        <div style={{ fontSize: 14 }}>
          Selecione uma empresa pra cadastrar despesas (sem modo consolidado/grupo).
        </div>
      </div>
    )
  }

  return <NovaDespesaForm companyId={empresaUnica} />
}
