import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesMensalidadesPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Gestao de Mensalidades"
      descricao="Visao consolidada de todas as mensalidades ativas, com previsao de receita, gestao de reajustes anuais, suspensoes e renovacoes."
      previsao="Q4 2026"
      recursos={[
        'Lista de mensalidades ativas com filtro por cliente/produto',
        'Reajuste anual automatico (IPCA/IGP-M/customizado)',
        'Suspensao e reativacao de contratos com auditoria',
        'Previsao de receita projetada 12 meses',
        'Historico de alteracoes de plano por cliente',
      ]}
      atalhos={[{ label: 'Contratos Recorrentes', href: '/dashboard/contratos' }]}
      ctaPriorizacao
    />
  )
}
