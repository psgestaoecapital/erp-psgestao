// src/app/dashboard/bpo/conciliacao/page.tsx
// Wrapper BPO da Conciliacao — preserva contexto de area BPO no sidebar/switcher
// enquanto reusa todo o conteudo do Hub Universal /dashboard/conciliacao.
//
// Decisao arquitetural: Hub Universal continua sendo a fonte unica da Conciliacao
// (commit ac5b2de 28/04/2026). Este wrapper apenas mantem contexto visual — o
// layout (src/app/dashboard/layout.tsx) detecta area pelo pathname.startsWith
// ('/dashboard/bpo'), entao manter o URL em /dashboard/bpo/conciliacao garante
// sidebar/switcher BPO ativos enquanto renderizamos o conteudo do Hub.
//
// Substitui o placeholder "em construcao" criado no PR #108 — o conteudo real
// da Conciliacao ja existe (Hub Universal) e nao deve ficar atras de placeholder.
//
// Limitacao conhecida: clicar num lote dispara router.push('/dashboard/conciliacao/{id}')
// dentro do Hub e leva o usuario para a rota detalhe fora do contexto BPO.
// Tratamento desse caso fica para um wrapper de detalhe futuro.

'use client'

import ConciliacaoHubPage from '@/app/dashboard/conciliacao/page'

export default function BpoConciliacaoPage() {
  return <ConciliacaoHubPage />
}
