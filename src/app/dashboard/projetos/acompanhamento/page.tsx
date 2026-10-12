'use client'

// Hub · "Orçado vs realizado" já existe pronto em /obras/resultado (v_obra_resultado: previsto × realizado
// por obra). A aba não mostra mais a casca "Fase 6 · em construção" — leva direto para a tela real (RD-52).
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AcompanhamentoPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/projetos/obras/resultado') }, [router])
  return (
    <div style={{ padding: 24, color: 'rgba(61,35,20,0.55)', fontSize: 13 }}>
      Abrindo Orçado vs realizado…
    </div>
  )
}
