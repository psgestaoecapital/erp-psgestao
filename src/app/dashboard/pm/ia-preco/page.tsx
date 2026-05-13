import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function PmIaPrecoPage() {
  return (
    <ModuloEmConstrucao
      area="P&M"
      titulo="IA Preco Otimo"
      descricao="Sugestao de precificacao por job baseada em historico interno + benchmark de mercado. Considera escopo, prazo, complexidade e margem-alvo."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Workspace da Agencia', href: '/dashboard/producao' },
      ]}
    />
  )
}
