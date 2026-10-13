import { Suspense } from 'react'
import DevolucaoCompraClient from './DevolucaoCompraClient'

export const dynamic = 'force-dynamic'

export default function NFeDevolucaoCompraPage() {
  // Suspense: DevolucaoCompraClient usa useSearchParams (pré-preenche por ?recebida_id=).
  return (
    <Suspense fallback={null}>
      <DevolucaoCompraClient />
    </Suspense>
  )
}
