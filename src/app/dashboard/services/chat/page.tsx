import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ServicesChatPage() {
  return (
    <ModuloEmConstrucao
      area="Servicos Recorrentes"
      titulo="Atendimento Chat IA"
      descricao="Chat com IA treinada nos dados do cliente + handoff humano quando necessario. Reduz volume no SAC mantendo qualidade."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Contratos Recorrentes', href: '/dashboard/contratos' },
      ]}
    />
  )
}
