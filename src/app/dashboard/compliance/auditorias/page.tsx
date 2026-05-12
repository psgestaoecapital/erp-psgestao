import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ComplianceAuditoriasPage() {
  return (
    <ModuloEmConstrucao
      area="Compliance"
      titulo="Auditorias NR"
      descricao="Planejamento e registro de auditorias internas das NRs aplicaveis a empresa: checklist por norma, evidencias fotograficas, plano de acao com responsaveis e prazos, e gestao de nao-conformidades ate fechamento."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Matriz de Conformidade', href: '/dashboard/compliance/matriz' },
        { label: 'Documentos da Empresa', href: '/dashboard/compliance/empresa' },
      ]}
    />
  )
}
