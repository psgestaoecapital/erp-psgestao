import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesDashboardSaasPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Dashboard MRR / Churn"
      descricao="Metricas SaaS para empresas de servicos recorrentes: MRR, ARR, churn voluntario e involuntario, LTV, CAC, payback e cohort retention."
      previsao="Q4 2026"
      recursos={[
        'MRR/ARR em tempo real com grafico de evolucao 12m',
        'Churn rate voluntario (cancelamento) vs involuntario (cobranca falhou)',
        'LTV, CAC e payback period por linha de negocio',
        'Cohort retention mensal e anual',
        'Alertas de queda de MRR > 5% no mes',
      ]}
      atalhos={[{ label: 'Contratos Recorrentes', href: '/dashboard/contratos' }]}
      ctaPriorizacao
    />
  )
}
