'use client'

import { useEffect, useState } from 'react'
import HeaderGE from './HeaderGE'
import SemaforoSaude from './SemaforoSaude'
import KpisDashboard from './KpisDashboard'
import ColunaContas from './ColunaContas'
import ColunaFluxoCaixa from './ColunaFluxoCaixa'
import ColunaInadimplentes from './ColunaInadimplentes'
import DREDivisional from './DREDivisional'
import BlocoConsultorIA from './BlocoConsultorIA'
import AtalhosRapidos from './AtalhosRapidos'
import HeroSaldoBancario from './HeroSaldoBancario'
import CardConciliacoesPendentes from './CardConciliacoesPendentes'
import FaixaAlertas from './FaixaAlertas'
import OnboardingStepper from '@/components/onboarding/OnboardingStepper'
import { useDashboardOperacional } from '@/hooks/useDashboardOperacional'
import { supabase } from '@/lib/supabase'

interface Props {
  companyId: string
  companyName: string
  userName: string
}

interface Maturidade {
  contas: number
  clientes: number
  lancamentos: number
  eh_madura: boolean
  pct_maturidade: number
}

export default function DashboardRico({ companyId, companyName, userName }: Props) {
  const { data: painel, loading: painelLoading } = useDashboardOperacional([companyId])
  const [maturidade, setMaturidade] = useState<Maturidade | null>(null)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    ;(async () => {
      const { data } = await supabase.rpc('fn_onboarding_maturidade', { p_company_id: companyId })
      if (!ignore) setMaturidade(data as Maturidade)
    })()
    return () => { ignore = true }
  }, [companyId])

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh' }}>
      <FaixaAlertas companyId={companyId} />

      <HeaderGE companyId={companyId} companyName={companyName} userName={userName} />

      <div style={{ padding: '32px 28px 24px', maxWidth: 1400, margin: '0 auto' }}>
        {maturidade && !maturidade.eh_madura && (
          <OnboardingStepper
            companyId={companyId}
            modulo="financeiro"
            passos={[
              { id: 'criar_conta', titulo: 'Cadastre sua primeira conta bancária', descricao: 'Para acompanhar saldos e movimentações', link: '/dashboard/cadastros/contas-bancarias', ehConcluido: maturidade.contas >= 1 },
              { id: 'cadastrar_clientes', titulo: 'Cadastre seus primeiros 3 clientes', descricao: 'Para emitir cobranças', link: '/dashboard/cadastros/clientes', ehConcluido: maturidade.clientes >= 3 },
              { id: 'primeiro_lancamento', titulo: 'Lance sua primeira despesa ou receita', descricao: 'Para começar a controlar o caixa', link: '/dashboard/financeiro/nova-despesa', ehConcluido: maturidade.lancamentos >= 1 },
              { id: 'importar_extrato', titulo: 'Importe extrato bancário OFX', descricao: 'Para conciliar movimentações automaticamente', link: '/dashboard/financeiro/conciliacao', ehConcluido: maturidade.lancamentos >= 10 },
            ]}
            onMaduro={() => setMaturidade((m) => m ? { ...m, eh_madura: true } : m)}
          />
        )}

        <HeroSaldoBancario
          total={painel?.saldos_bancarios?.total ?? null}
          qtdContas={painel?.saldos_bancarios?.qtd_contas ?? null}
          loading={painelLoading}
        />

        {painel?.conciliacoes_pendentes && (
          <CardConciliacoesPendentes
            qtd={painel.conciliacoes_pendentes.qtd}
            valorEstimado={painel.conciliacoes_pendentes.valor_estimado}
          />
        )}

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

