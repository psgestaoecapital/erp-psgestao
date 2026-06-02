import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesNpsPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Pesquisa NPS"
      descricao="Pesquisa de satisfacao NPS automatizada com gatilhos por evento (pos-onboarding, pos-renovacao, trimestral), classificacao de detratores e fluxo de acao."
      previsao="Q1 2027"
      recursos={[
        'Envio automatico em 3 momentos: D+30 onboarding, pos-renovacao, trimestral',
        'Classificacao automatica: promotor (9-10), neutro (7-8), detrator (0-6)',
        'Alerta para o time comercial em cada detrator novo',
        'Dashboard de NPS por coorte, segmento e periodo',
        'Comentarios abertos com tagging automatico via IA',
      ]}
      atalhos={[{ label: 'Contratos Recorrentes', href: '/dashboard/contratos' }]}
      ctaPriorizacao
    />
  )
}
