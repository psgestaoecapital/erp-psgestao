'use client'

// DRE HORIZONTAL CONSOLIDADO (Grupo) — F1.
// Meses nas colunas, linhas colapsáveis por conta, consolidando os CNPJs do
// grupo (dashboard_grupos_empresas), com projeção marcada e toggle de regime.
// Backend: fn_psgc_dre_horizontal (espelha a aritmética de fn_psgc_dre_consolidada).

import DREHorizontal from '@/components/financeiro/DREHorizontal'

export default function Page() {
  return <DREHorizontal />
}
