import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function PmApontamentoHorasPage() {
  return (
    <ModuloEmConstrucao
      area="P&M"
      titulo="Apontamento de Horas"
      descricao="Registro de horas trabalhadas por job + relatorios de produtividade por colaborador, com calculo automatico de custo-hora."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Workspace da Agencia', href: '/dashboard/producao' },
      ]}
    />
  )
}
