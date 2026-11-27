// Rota legada · Permutas saiu do Hub e passou para Gestão Empresarial › Financeiro (CEO 27/11).
// Stub de redirect 308 (defesa em profundidade); o 308 oficial vem do next.config.ts. Mantém a rota antiga com
// página real (satisfaz o check-menu enquanto o module_catalog ainda aponta a rota antiga no preview) e preserva a
// query string. Links/bookmarks antigos não quebram.
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
  permanentRedirect(`/dashboard/gestao-empresarial/permutas${qs.size ? '?' + qs.toString() : ''}`)
}
