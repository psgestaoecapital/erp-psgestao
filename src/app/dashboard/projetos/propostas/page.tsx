'use client'

// RD-52 · 1 fonte de verdade: a "lista de propostas" É /dashboard/orcamentos (erp_orcamentos, com
// hash público, versão, aprovação, elo Pedido). A aba do Hub NÃO cria uma segunda lista — redireciona
// pra real. Mata a casca "Fase 5 · em construção" que mentia enquanto o fluxo já roda (#674).
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PropostasPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/orcamentos') }, [router])
  return (
    <div style={{ padding: 24, color: 'rgba(61,35,20,0.55)', fontSize: 13 }}>
      Abrindo Propostas (orçamentos)…
    </div>
  )
}
