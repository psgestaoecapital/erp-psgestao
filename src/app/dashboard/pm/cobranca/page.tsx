import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function PmCobrancaPage() {
  return (
    <ModuloEmConstrucao
      area="P&M"
      titulo="Cobranca por Etapa"
      descricao="Faturamento parcial conforme entregas: divide o valor total do job em marcos com gatilho automatico de cobranca quando o cliente aprova."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Workspace da Agencia', href: '/dashboard/producao' },
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
