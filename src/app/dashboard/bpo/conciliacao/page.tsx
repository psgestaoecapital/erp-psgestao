import BpoModuloEmConstrucao from '@/components/bpo/BpoModuloEmConstrucao'

export default function BpoConciliacaoPage() {
  return (
    <BpoModuloEmConstrucao
      titulo="Conciliacao Bancaria"
      descricao="Conciliacao automatica entre extrato bancario (OFX/CSV/API) e lancamentos do ERP, com matching por valor + data + descricao e fila de excecoes para revisao humana. Sera reconstruida sobre a nova arquitetura de Inbox."
      previsao="2026 Q3"
    />
  )
}
