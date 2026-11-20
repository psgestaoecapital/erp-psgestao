'use client'

// Plano de Ação 5W2H no Hub de Projetos (CEO 20/11). Mesma tela da Indústria, pelo
// componente compartilhado PlanoAcaoView — mesmo motor (erp_plano_acao + reuniões,
// fn_plano_acao_*). O elo opcional ação/reunião → obra do Hub entra em fatia seguinte.

import PlanoAcaoView from '@/components/plano-acao/PlanoAcaoView'

export default function PlanoAcaoHubPage() {
  return <PlanoAcaoView />
}
