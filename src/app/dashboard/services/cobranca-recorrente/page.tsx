import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesCobrancaRecorrentePage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Cobranca Recorrente"
      descricao="Regua de cobranca automatica para mensalidades, contratos e parcelados. Boletos + Pix + cartao integrados, com lembrete amigavel antes do vencimento e escalacao de inadimplencia."
      previsao="Q3 2026"
      recursos={[
        'Geracao automatica de boletos/Pix mensais',
        'Regua de cobranca configuravel (D-3, D+0, D+5, D+15)',
        'WhatsApp + e-mail de lembrete automatico',
        'Integracao com Sicoob, Bradesco, Itau e Inter',
        'Dashboard de inadimplencia consolidada',
      ]}
      atalhos={[{ label: 'Contratos Recorrentes', href: '/dashboard/contratos' }]}
      ctaPriorizacao
    />
  )
}
