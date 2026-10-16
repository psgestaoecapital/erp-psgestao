// /login não é a tela de entrada (ela é a raiz "/"); quem chega aqui é encaminhado para "/" preservando o returnTo.
import { redirect } from 'next/navigation'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const sp = await searchParams
  const r = Array.isArray(sp.returnTo) ? sp.returnTo[0] : sp.returnTo
  redirect(r ? `/?returnTo=${encodeURIComponent(r)}` : '/')
}
