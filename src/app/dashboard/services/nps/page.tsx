import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesNpsPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Pesquisa NPS"
      descricao="Envio automatico de NPS apos marcos definidos (30/90/180 dias). Analise de respostas com IA e classificacao automatica de promotores/detratores."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
