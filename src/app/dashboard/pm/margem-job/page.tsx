import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function PmMargemJobPage() {
  return (
    <ModuloEmConstrucao
      area="P&M"
      titulo="Margem por Job"
      descricao="Calculo automatico custo vs receita por job: horas apontadas x custo-hora, despesas alocadas e fornecedores. Margem em tempo real."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Workspace da Agencia', href: '/dashboard/producao' },
      ]}
    />
  )
}
