import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesNfsePage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="NFS-e"
      descricao="Emissao de Notas Fiscais de Servico integrada (eNotas/Focus NFe) com gatilho automatico apos confirmacao de pagamento."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
