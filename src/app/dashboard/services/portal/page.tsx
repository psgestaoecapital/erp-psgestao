import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesPortalPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Portal do Cliente"
      descricao="Portal self-service para o cliente final acessar faturas, contratos, segunda via, comprovantes, NFS-e e abrir tickets de suporte sem precisar ligar."
      previsao="Q1 2027"
      recursos={[
        'Login do cliente com 2FA (e-mail/SMS)',
        'Segunda via de boleto e Pix em 1 clique',
        'Historico de pagamentos + comprovantes (PDF)',
        'Download de NFS-e emitidas no periodo',
        'Abertura de chamados de suporte com SLA visivel',
      ]}
      atalhos={[{ label: 'Contratos Recorrentes', href: '/dashboard/contratos' }]}
      ctaPriorizacao
    />
  )
}
