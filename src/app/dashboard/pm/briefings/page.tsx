import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function PmBriefingsPage() {
  return (
    <ModuloEmConstrucao
      area="P&M"
      titulo="Briefings"
      descricao="Captura estruturada de briefings de clientes com versionamento, aprovacao e link automatico com Jobs do Workspace da Agencia."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Workspace da Agencia', href: '/dashboard/producao' },
      ]}
    />
  )
}
