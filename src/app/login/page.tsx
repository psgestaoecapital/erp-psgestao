import { redirect } from 'next/navigation'
import { urlDeLogin } from '@/lib/retornoLogin'

// A tela de login mora em `/`. Esta rota existe só para endereços antigos `/login?returnTo=...` (antes davam 404).
export default async function LoginLegado({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams
  const r = Array.isArray(returnTo) ? returnTo[0] : returnTo
  redirect(urlDeLogin(r ?? ''))
}
