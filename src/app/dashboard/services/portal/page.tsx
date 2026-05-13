import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesPortalPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Portal do Cliente"
      descricao="Area externa para clientes finais consultarem mensalidades, baixarem NFS-e, abrir chamados e atualizar dados cadastrais sem precisar contatar o time."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
