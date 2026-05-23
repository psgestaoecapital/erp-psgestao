'use client'

import HeaderGE from './HeaderGE'
import SemaforoSaude from './SemaforoSaude'
import KpisDashboard from './KpisDashboard'
import ColunaContas from './ColunaContas'
import ColunaFluxoCaixa from './ColunaFluxoCaixa'
import ColunaInadimplentes from './ColunaInadimplentes'
import DREDivisional from './DREDivisional'
import BlocoConsultorIA from './BlocoConsultorIA'
import AtalhosRapidos from './AtalhosRapidos'

interface Props {
  companyId: string
  companyName: string
  userName: string
}

export default function DashboardRico({ companyId, companyName, userName }: Props) {
  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh' }}>
      <HeaderGE companyId={companyId} companyName={companyName} userName={userName} />

      <div style={{ padding: '32px 28px 24px', maxWidth: 1400, margin: '0 auto' }}>
        <SemaforoSaude companyId={companyId} />
        <KpisDashboard companyId={companyId} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
            marginBottom: 40,
          }}
        >
          <ColunaContas companyId={companyId} />
          <ColunaFluxoCaixa companyId={companyId} />
          <ColunaInadimplentes companyId={companyId} />
        </div>

        <DREDivisional companyId={companyId} />
        <BlocoConsultorIA companyId={companyId} />
        <AtalhosRapidos />
      </div>
    </div>
  )
}
