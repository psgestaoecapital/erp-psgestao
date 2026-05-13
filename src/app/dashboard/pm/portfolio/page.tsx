import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function PmPortfolioPage() {
  return (
    <ModuloEmConstrucao
      area="P&M"
      titulo="Portfolio de Entregas"
      descricao="Galeria publica de cases entregues, com filtros por segmento, tipo de servico e cliente. Auto-alimentada pelos jobs entregues."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Workspace da Agencia', href: '/dashboard/producao' },
      ]}
    />
  )
}
