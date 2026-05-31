import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesCobrancaRecorrentePage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Cobranca Recorrente"
      descricao="Geracao automatica de boletos mensais a partir de Contratos Recorrentes ativos. Integracao com Asaas/Cora + envio de lembretes."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
