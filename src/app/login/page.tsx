// /login nunca existiu como tela (o login é a raiz "/"), mas a sessão expirada e guardas antigas
// redirecionam para cá: encaminha para "/" preservando o returnTo.
import { redirect } from 'next/navigation'

export default async function LoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>
}) {
  const sp = await searchParams
  const bruto = Array.isArray(sp.returnTo) ? sp.returnTo[0] : sp.returnTo
  redirect(bruto ? `/?returnTo=${encodeURIComponent(bruto)}` : '/')
}
