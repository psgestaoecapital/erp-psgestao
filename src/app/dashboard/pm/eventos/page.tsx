import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function PmEventosPage() {
  return (
    <ModuloEmConstrucao
      area="P&M"
      titulo="Eventos & Producoes"
      descricao="Gestao completa de eventos e producoes audiovisuais: timeline, equipe, fornecedores, checklist de pre/durante/pos-producao e fechamento."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Workspace da Agencia', href: '/dashboard/producao' },
      ]}
    />
  )
}
