import { redirect } from 'next/navigation'
import { retornoSeguro } from '@/lib/retorno-login'

// Rota legada: o login vive em "/". Encaminha preservando o returnTo.
export default async function LoginRedirect({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams
  const r = retornoSeguro(returnTo)
  redirect(r ? `/?returnTo=${encodeURIComponent(r)}` : '/')
}
