// Plano de Ação 5W2H no Hub de Projetos (CEO 20/11). Mesmo componente da Indústria (PlanoAcaoTela) + vínculo à OBRA:
// ação e reunião podem apontar para uma obra, há filtro por obra e "Onde" sugere a obra. A gravação de reunião → ata +
// ações 5W2H com IA (PR #5676) aparece igual, porque é o mesmo componente. Nenhuma tabela/RPC renomeada.
import PlanoAcaoTela from '@/components/plano-acao/PlanoAcaoTela'

export default function Page() {
  return <PlanoAcaoTela config={{ contexto: 'projetos', mostrarObra: true, eyebrow: 'Hub de Projetos · Obras' }} />
}
