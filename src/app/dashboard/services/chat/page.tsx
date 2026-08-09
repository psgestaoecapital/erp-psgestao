import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesChatPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Atendimento Chat IA"
      descricao="Atendimento automatizado via WhatsApp e chat in-app, com IA respondendo duvidas sobre faturas, contratos, segunda via de boleto e suporte de primeiro nivel."
      previsao="Q1 2027"
      recursos={[
        'Bot WhatsApp 24/7 integrado ao Pluggy + sua base de FAQ',
        'Resolucao automatica de 60-80% dos tickets (segunda via, status pagamento, contratos)',
        'Escalacao humana com contexto preservado',
        'Dashboard de volume de atendimento e satisfacao',
        'Historico de conversas por cliente com busca semantica',
      ]}
      atalhos={[{ label: 'Contratos Recorrentes', href: '/dashboard/contratos' }]}
      ctaPriorizacao
    />
  )
}
