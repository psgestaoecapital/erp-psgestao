import { redirect } from 'next/navigation'

// A sessão expirada (AuthProvider) leva a /login?returnTo=...; o login real mora em "/".
export default async function LoginRedirect({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams
  redirect(returnTo ? `/?returnTo=${encodeURIComponent(returnTo)}` : '/')
}
