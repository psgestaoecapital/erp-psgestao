import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesCancelamentoPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Workflow de Cancelamento"
      descricao="Fluxo formal de cancelamento com motivo categorizado, oferta de retencao automatica, periodo de carencia e desligamento do contrato no prazo correto."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
