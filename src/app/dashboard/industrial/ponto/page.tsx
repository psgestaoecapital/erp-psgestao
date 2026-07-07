'use client'

// FEATURE-TELA-PONTO (07/07 · diretriz CEO): lente INDUSTRIAL do ponto
// provider-agnostic. Antes esta page era so o utilitario de sync (#553);
// agora a tela completa vive em PontoView (compartilhada com a lente
// Compliance em /dashboard/compliance/ponto — mesma fonte, duas lentes).

import PontoView from '@/components/ponto/PontoView'

export default function Page() {
  return <PontoView lente="industrial" />
}
