'use client'

// FEATURE-TELA-PONTO (07/07 · diretriz CEO): lente COMPLIANCE do ponto
// provider-agnostic. Mesmos dados da lente Industrial
// (/dashboard/industrial/ponto) + botao "Importar pro Compliance"
// (fn_compliance_projetar_de_ind_ponto — preserva metadados manuais).

import PontoView from '@/components/ponto/PontoView'

export default function Page() {
  return <PontoView lente="compliance" />
}
