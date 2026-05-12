import BpoModuloEmConstrucao from '@/components/bpo/BpoModuloEmConstrucao'

export default function BpoAtribuicaoPage() {
  return (
    <BpoModuloEmConstrucao
      titulo="Atribuicao Operador-Cliente"
      descricao="Tela administrativa para vincular operadores BPO (titular + backup) a empresas-cliente, com visao de carga consolidada, rebalanceamento sugerido pela IA e historico de mudancas. Hoje parte desse fluxo ja existe em Supervisao — esta tela sera a versao dedicada."
      previsao="2026 Q3"
      atalhos={[
        { label: 'Supervisao (atual)', href: '/dashboard/bpo/supervisao' },
        { label: 'Meu Dia', href: '/dashboard/bpo/meu-dia' },
        { label: 'Inbox', href: '/dashboard/bpo/inbox' },
      ]}
    />
  )
}
