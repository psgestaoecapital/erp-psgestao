'use client'

import { useCompanyIds } from '@/lib/useCompanyIds'
import ListagemPagarReceberView from '@/components/financeiro/ListagemPagarReceberView'

export default function Page() {
  const { companyIds } = useCompanyIds()
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null

  if (!empresaUnica) {
    return <SelecioneEmpresa titulo="Receitas a receber" />
  }

  return <ListagemPagarReceberView companyId={empresaUnica} tipo="receber" />
}

function SelecioneEmpresa({ titulo }: { titulo: string }) {
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
        {titulo}
      </div>
      <div style={{ fontSize: 14 }}>
        Selecione uma empresa pra ver a listagem (sem modo consolidado/grupo).
      </div>
    </div>
  )
}
