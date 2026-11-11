'use client'

// Caixa do grupo — "caixa do dia" do grupo econômico (F1, só leitura).
// Item 5 (P2/Pdois, CEO 11/11). Backend: fn_fin_caixa_grupo_dia (consolida os CNPJs do grupo).

import CaixaGrupoDia from '@/components/financeiro/CaixaGrupoDia'

export default function Page() {
  return <CaixaGrupoDia />
}
