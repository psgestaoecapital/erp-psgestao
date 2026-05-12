import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ComplianceEsocialPage() {
  return (
    <ModuloEmConstrucao
      area="Compliance"
      titulo="eSocial"
      descricao="Geracao e transmissao dos eventos S-2200 (admissao), S-2206 (alteracao contratual), S-1200 (remuneracao) e S-2230 (afastamento) com integracao gov.br. Substitui o envio manual via portal do empregador."
      previsao="Q3 2026"
      atalhos={[
        { label: 'Funcionarios', href: '/dashboard/compliance/funcionarios' },
        { label: 'Matriz de Conformidade', href: '/dashboard/compliance/matriz' },
      ]}
    />
  )
}
