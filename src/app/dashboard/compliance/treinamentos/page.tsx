import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ComplianceTreinamentosPage() {
  return (
    <ModuloEmConstrucao
      area="Compliance"
      titulo="Treinamentos NR"
      descricao="Controle de treinamentos obrigatorios por NR (NR-6, NR-10, NR-12, NR-33, NR-35, etc.) com cadastro de turmas, lista de presenca, emissao de certificados e alertas automaticos de reciclagem antes do vencimento."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Funcionarios', href: '/dashboard/compliance/funcionarios' },
        { label: 'Painel Compliance', href: '/dashboard/compliance' },
      ]}
    />
  )
}
