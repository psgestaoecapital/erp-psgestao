'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCompanyIds } from '@/lib/useCompanyIds'
import NovaReceitaForm from '@/components/financeiro/NovaReceitaForm'

// FIX-CONCILIACAO-NOVA-CONTA (07/07): useSearchParams em Next 16 exige
// Suspense boundary + force-dynamic. Sem isso, ?origem_conciliacao,
// ?valor, ?data, ?descricao nao hidratam no fluxo "Incluir nova conta"
// vindo da Conciliacao — form abre vazio, nao concilia, redireciona errado.
export const dynamic = 'force-dynamic'

function NovaReceitaPageInner() {
  const { companyIds, selInfo } = useCompanyIds()
  // #71 · ?editar=<id> abre o lançamento existente nesta MESMA tela (modo edição)
  const editarId = useSearchParams()?.get('editar') ?? undefined
  // FIX-VAZAMENTO-JORDANA (07/07 · seguindo padrao das outras telas
  // operacionais): so opera com empresa unica selecionada. Antes usava
  // apenas companyIds.length === 1 que aceitava grupo/consolidado se
  // por acaso houvesse so 1 empresa acessivel.
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
          Nova receita
        </div>
        <div style={{ fontSize: 14 }}>
          Selecione uma empresa pra cadastrar receitas (sem modo consolidado/grupo).
        </div>
      </div>
    )
  }

  return <NovaReceitaForm companyId={empresaUnica} editarId={editarId} />
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
      <NovaReceitaPageInner />
    </Suspense>
  )
}
