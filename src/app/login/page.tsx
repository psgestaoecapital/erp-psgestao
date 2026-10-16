import { redirect } from 'next/navigation'

// Rota legada: o guarda de sessão manda para /login?returnTo=...; o login real mora em "/".
export default async function LoginRedirect({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams
  const rt = Array.isArray(returnTo) ? returnTo[0] : returnTo
  redirect(rt ? `/?returnTo=${encodeURIComponent(rt)}` : '/')
}
