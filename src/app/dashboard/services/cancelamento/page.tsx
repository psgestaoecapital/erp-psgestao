import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesCancelamentoPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Workflow de Cancelamento"
      descricao="Fluxo guiado de cancelamento que oferece retencao (desconto, downgrade, pausa), coleta motivo do churn e processa rescisao sem friccao."
      previsao="Q1 2027"
      recursos={[
        'Wizard de 3 passos: motivo -> oferta retencao -> confirmacao',
        'Retencao automatica (desconto temporario, downgrade, pausa de 30/60/90 dias)',
        'Captura estruturada de motivos de churn para analise',
        'Notificacoes para o time comercial (last-chance call)',
        'Processamento da rescisao com geracao de documento e bloqueio de cobranca',
      ]}
      atalhos={[{ label: 'Contratos Recorrentes', href: '/dashboard/contratos' }]}
      ctaPriorizacao
    />
  )
}
