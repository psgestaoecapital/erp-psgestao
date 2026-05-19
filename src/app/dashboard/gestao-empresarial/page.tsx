import { Suspense } from 'react'
import GestaoEmpresarialHubClient from './_components/GestaoEmpresarialHubClient'
import { GestaoEmpresarialHubSkeleton } from './_components/GestaoEmpresarialHubSkeleton'

export const dynamic = 'force-dynamic'

export default function GestaoEmpresarialPage() {
  return (
    <Suspense fallback={<GestaoEmpresarialHubSkeleton />}>
      <GestaoEmpresarialHubClient />
    </Suspense>
  )
}
