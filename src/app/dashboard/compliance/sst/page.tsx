import ModuloEmConstrucao from '@/components/shared/ModuloEmConstrucao'

export default function ComplianceSstPage() {
  return (
    <ModuloEmConstrucao
      area="Compliance"
      titulo="SST - Saude do Trabalho"
      descricao="Modulo de Saude e Seguranca do Trabalho: gestao de exames ocupacionais (ASO), CAT (Comunicacao de Acidente de Trabalho), PCMSO, PGR e indicadores de saude com integracao ao eSocial S-2210/S-2220/S-2240."
      previsao="Q4 2026"
      atalhos={[
        { label: 'Funcionarios', href: '/dashboard/compliance/funcionarios' },
        { label: 'Painel EPI', href: '/dashboard/compliance/epi' },
      ]}
    />
  )
}
