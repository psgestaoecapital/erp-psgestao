import { redirect } from 'next/navigation'

// /login nunca existiu como tela (o login é a raiz). Quem chega aqui (link antigo, redirecionamento de sessão
// expirada) segue para "/" preservando o returnTo.
export default async function LoginRedirect({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams
  const rt = Array.isArray(returnTo) ? returnTo[0] : returnTo
  redirect(rt ? `/?returnTo=${encodeURIComponent(rt)}` : '/')
}
