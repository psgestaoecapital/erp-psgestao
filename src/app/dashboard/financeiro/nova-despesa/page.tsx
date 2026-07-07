'use client'

import { Suspense } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import NovaDespesaForm from '@/components/financeiro/NovaDespesaForm'

// FIX-CONCILIACAO-NOVA-CONTA (07/07): useSearchParams em Next 16 exige
// Suspense boundary + force-dynamic. Sem isso, ?origem_conciliacao,
// ?valor, ?data, ?descricao nao hidratam no fluxo "Incluir nova conta"
// vindo da Conciliacao — form abre vazio, nao concilia, redireciona errado.
export const dynamic = 'force-dynamic'

function NovaDespesaPageInner() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  if (!empresaUnica) {
    return (
      <div
        style={{
          padding: 32,
          color: 'rgba(61,35,20,0.7)',
          background: '#FAF7F2',
          minHeight: '100vh',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'rgba(61,35,20,0.55)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          Nova despesa
        </div>
        <div style={{ fontSize: 14 }}>
          Selecione uma empresa pra cadastrar despesas (sem modo consolidado/grupo).
        </div>
      </div>
    )
  }

  return <NovaDespesaForm companyId={empresaUnica} />
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 32, color: 'rgba(61,35,20,0.7)', background: '#FAF7F2', minHeight: '100vh' }}>
          Carregando…
        </div>
      }
    >
      <NovaDespesaPageInner />
    </Suspense>
  )
}
