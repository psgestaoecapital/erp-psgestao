'use client'
// GE · Financeiro — Faturar OS (fila da Jordana). A Oficina só LISTA (visibilidade); quem gera o
// título (contas a receber) é a Gestão Empresarial (fronteira RD-44, CEO 12/09). Genérica por empresa.
import { useCompanyIds } from '@/lib/useCompanyIds'
import FaturarOsView from '@/components/financeiro/FaturarOsView'

export default function Page() {
  const { companyIds } = useCompanyIds()
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null
  if (!empresaUnica) {
    return (
      <div style={{ padding: 32, color: 'rgba(61,35,20,0.7)', background: '#FAF7F2', minHeight: '100vh' }}>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Faturar OS</div>
        <div style={{ fontSize: 14 }}>Selecione uma empresa específica (sem consolidado/grupo) para faturar as OS entregues.</div>
      </div>
    )
  }
  return <FaturarOsView companyId={empresaUnica} />
}
