import { redirect } from 'next/navigation'

export default async function ConciliacaoLoteRedirectPage({
  params,
}: {
  params: Promise<{ lote_id: string }>
}) {
  const { lote_id } = await params
  redirect(`/dashboard/conciliacao/${lote_id}`)
}
