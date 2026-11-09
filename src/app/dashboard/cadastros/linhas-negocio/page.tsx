// PDCA GE (Princ.3 menu limpo) · stub de redirect 308 (defesa em profundidade); o 308 oficial vem do
// next.config.ts. Esta rota duplicava a tela canônica de Divisões (/dashboard/cadastros/divisoes, a única
// no menu) com o mesmo componente. Mantém página real (links salvos não quebram) e preserva a query string.
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
  permanentRedirect(`/dashboard/cadastros/divisoes${qs.size ? '?' + qs.toString() : ''}`)
}
