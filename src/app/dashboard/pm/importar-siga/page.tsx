// RD-100 · stub de redirect 308 (defesa em profundidade); o 308 oficial vem do next.config.ts.
// Mantém a rota antiga com página real (satisfaz o check_menu) e preserva query string.
import { permanentRedirect } from 'next/navigation'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x))
    else if (v != null) qs.append(k, v)
  }
  permanentRedirect(`/dashboard/pm/importar-sistema-anterior${qs.size ? '?' + qs.toString() : ''}`)
}
