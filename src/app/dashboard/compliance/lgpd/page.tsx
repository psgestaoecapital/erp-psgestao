import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ComplianceLgpdPage() {
  return (
    <ModuloEmConstrucao
      area="Compliance"
      titulo="LGPD Gestao"
      descricao="Painel de conformidade LGPD: mapeamento de dados pessoais, registro de bases legais por tratamento, gestao de incidentes, atendimento a direitos do titular (Art. 18) e relatorio de impacto (RIPD)."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Painel Compliance', href: '/dashboard/compliance' },
        { label: 'Documentos da Empresa', href: '/dashboard/compliance/empresa' },
      ]}
    />
  )
}
