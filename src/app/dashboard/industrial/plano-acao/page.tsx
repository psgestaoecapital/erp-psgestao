// Plano de Ação 5W2H — Indústria. A tela é o componente compartilhado PlanoAcaoTela (CEO 20/11); esta rota continua
// idêntica (mesmas tabelas erp_plano_acao/erp_plano_acao_reuniao e RPCs fn_plano_acao_*). A versão do Hub de Projetos
// usa o MESMO componente em /dashboard/projetos/plano-acao, com o vínculo à obra ligado.
import PlanoAcaoTela from '@/components/plano-acao/PlanoAcaoTela'

export default function Page() {
  return <PlanoAcaoTela config={{ contexto: 'industrial' }} />
}
