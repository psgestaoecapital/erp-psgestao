'use client'

// Fila de Divergências (RD-49) — tela COMPARTILHADA. Serve gente/financeiro/fiscal/estoque,
// todos os tenants. A ingestão detecta; o humano resolve aqui; nunca pergunta de novo.
import CentralDivergencias from '@/components/divergencias/CentralDivergencias'

export default function DivergenciasPage() {
  return <CentralDivergencias />
}
