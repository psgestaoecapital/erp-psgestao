import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesNfsePage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="NFS-e (Nota Fiscal de Servico Eletronica)"
      descricao="Emissao de NFS-e em conformidade com o municipio do tomador. Integracao com prefeituras via padrao ABRASF + envio automatico ao cliente."
      previsao="Q3 2026"
      recursos={[
        'Emissao por contrato recorrente ou avulsa',
        'Suporte aos 5 padroes ABRASF (1.0, 2.x, 3.0, 4.0, DPS Nacional 2026)',
        'Calculo automatico de ISS, IRRF, INSS, PIS/COFINS retidos',
        'Cancelamento e substituicao com auditoria',
        'Envio automatico via e-mail + portal do cliente',
      ]}
      atalhos={[{ label: 'Contratos Recorrentes', href: '/dashboard/contratos' }]}
      ctaPriorizacao
    />
  )
}
