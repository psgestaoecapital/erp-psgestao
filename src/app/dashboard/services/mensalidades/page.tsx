import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesMensalidadesPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Gestao de Mensalidades"
      descricao="Controle de pagamentos mensais: status (pago/atrasado/vencendo), historico por cliente, regua de cobranca automatica e relatorios de inadimplencia."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
