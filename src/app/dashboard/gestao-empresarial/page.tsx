import { Suspense } from 'react'
import GestaoEmpresarialRouter from './_components/GestaoEmpresarialRouter'
import { GestaoEmpresarialHubSkeleton } from './_components/GestaoEmpresarialHubSkeleton'

export const dynamic = 'force-dynamic'

export default function GestaoEmpresarialPage() {
  return (
    <Suspense fallback={<GestaoEmpresarialHubSkeleton />}>
      <GestaoEmpresarialRouter />
    </Suspense>
  )
}
