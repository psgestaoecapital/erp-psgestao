import BpoModuloEmConstrucao from '@/components/bpo/BpoModuloEmConstrucao'

export default function BpoSlaPage() {
  return (
    <BpoModuloEmConstrucao
      titulo="SLA por Cliente"
      descricao="Painel de aderencia aos SLAs contratados por cliente: tempo medio de resposta no Inbox, atraso na classificacao, tempo de fechamento mensal e indices de retrabalho. Inclui alertas proativos quando SLA esta proximo do limite."
      previsao="2026 Q4"
    />
  )
}
