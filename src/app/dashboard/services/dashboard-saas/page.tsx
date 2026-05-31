import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesDashboardSaasPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Dashboard MRR / Churn"
      descricao="Metricas SaaS executivas: MRR, ARR, churn, LTV, CAC, payback. Atualizadas automaticamente a partir dos contratos recorrentes e cancelamentos."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
