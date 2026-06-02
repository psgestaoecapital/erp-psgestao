import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesOnboardingPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Onboarding IA Self-Service"
      descricao="Onboarding 100% automatizado para novos clientes: cadastro, primeira NF, primeira cobranca e ativacao do servico em menos de 10 minutos."
      previsao="Q1 2027"
      recursos={[
        'Wizard guiado de cadastro (CNPJ + dados bancarios + cartao)',
        'Validacao automatica Receita Federal + Pluggy KYC',
        'Geracao de contrato + assinatura eletronica integrada',
        'Primeira cobranca e ativacao do servico sem intervencao humana',
        'Metricas de conversao e friccao do funil de ativacao',
      ]}
      atalhos={[{ label: 'Contratos Recorrentes', href: '/dashboard/contratos' }]}
      ctaPriorizacao
    />
  )
}
