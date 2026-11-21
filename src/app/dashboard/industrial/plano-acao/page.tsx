'use client'

// Plano de Ação 5W2H — Indústria. A tela é o componente compartilhado PlanoAcaoView
// (src/components/plano-acao/PlanoAcaoView.tsx), reusado também pela rota do Hub
// (/dashboard/hub/plano-acao). Mesmo motor (erp_plano_acao + reuniões, fn_plano_acao_*):
// nenhuma rota/tabela/RPC renomeada; a Indústria continua idêntica.

import PlanoAcaoView from '@/components/plano-acao/PlanoAcaoView'

export default function PlanoAcaoIndustriaPage() {
  return <PlanoAcaoView />
}
