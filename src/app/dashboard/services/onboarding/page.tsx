import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesOnboardingPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Onboarding IA"
      descricao="Onboarding self-service com IA: coleta dados do novo cliente, configura conta, ativa primeiros modulos e dispara primeira fatura recorrente."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
