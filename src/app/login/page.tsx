// /login não é tela própria: o login vive em "/". Quem cai aqui (ex.: sessão expirada) segue para "/" com o returnTo.
import { redirect } from 'next/navigation'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams
  const rt = Array.isArray(returnTo) ? returnTo[0] : returnTo
  redirect(rt ? `/?returnTo=${encodeURIComponent(rt)}` : '/')
}
