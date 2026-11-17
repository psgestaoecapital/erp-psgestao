// PDCA GE (Princ.3 menu limpo · RD-98 p1 · auditor_pdca_2) · stub de redirect 308 (defesa em profundidade).
// Esta rota era um PLACEHOLDER <ModuloEmConstrucao> ("NFS-e em construção · Q3 2026") duplicando no menu a
// tela REAL de emissão de NFS-e, que vive em /dashboard/fiscal/nfse ("NFS-e Emitidas": lista + NFSeEmitirGovModal).
// A entrada morta foi desativada em module_catalog (migration) e esta rota passa a redirecionar para a canônica.
// O 308 oficial vem do next.config.ts e preserva a query string; mantemos a rota com página real (satisfaz o
// check de menu) e preservamos a query string também aqui.
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
  permanentRedirect(`/dashboard/fiscal/nfse${qs.size ? '?' + qs.toString() : ''}`)
}
