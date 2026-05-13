import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function PmAprovacaoPage() {
  return (
    <ModuloEmConstrucao
      area="P&M"
      titulo="Aprovacao Cliente"
      descricao="Fluxo de aprovacao de entregas pelo cliente final via link unico (sem login): comentarios, marcacao de revisao e historico de versoes."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Workspace da Agencia', href: '/dashboard/producao' },
      ]}
    />
  )
}
