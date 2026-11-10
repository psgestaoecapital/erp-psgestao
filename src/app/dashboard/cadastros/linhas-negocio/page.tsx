// PDCA GE (Princ.3 menu limpo · auditor_pdca_2 08/11) · stub de redirect 308 (defesa em profundidade).
// Esta rota renderizava o MESMO <LinhasNegocioList/> que /dashboard/cadastros/divisoes (mesma entidade
// business_lines) e era órfã (fora do module_catalog). Consolidada na rota canônica do menu (Divisões).
// O 308 oficial vem do next.config.ts; mantém a rota antiga com página real (satisfaz o check_menu) e
// preserva a query string.
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
