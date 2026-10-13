// FIX-NAV-COMMERCE-EM-GE-v1 · stub de redirect 308 (defesa em profundidade).
// O 308 oficial vem do next.config.ts redirects() — este stub cobre caminhos
// que escapem (preview, build dev). Preserva query string.
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
  permanentRedirect(`/dashboard/commerce/estoque${qs.size ? '?' + qs.toString() : ''}`)
}
