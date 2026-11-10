// PDCA GE (Princ.3 menu limpo · auditor) · stub de redirect 308 (defesa em profundidade).
// Esta rota era uma SEGUNDA tela de fornecedores (CRUD inline) sobre a MESMA entidade erp_fornecedores,
// porém órfã (fora do module_catalog). A tela do MENU é /dashboard/cadastros/fornecedores (PessoasList).
// Consolidada na rota canônica do menu; o 308 oficial vem do next.config.ts e preserva a query string
// (ex.: o deep-link ?busca= que vinha de remessa-pagamento). Mantém a rota antiga com página real
// (satisfaz o check de menu) e preserva a query string também aqui.
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
  permanentRedirect(`/dashboard/cadastros/fornecedores${qs.size ? '?' + qs.toString() : ''}`)
}
