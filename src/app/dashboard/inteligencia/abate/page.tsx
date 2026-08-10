'use client'
// SPEC · Irrigar BI: Abate / Rendimentos (2º âmbito). WRAPPER FINO do motor GENÉRICO
// (fn_ind_ambito_painel, âmbito 'abate') sobre o canônico ind_abate_evento: CAB/PTC/PMC/ARB/RAS com dado,
// série (dia/semana/mês/ano), pivot por turno/espécie/lote, aba Metas, escopo fail-closed.
// REN (rendimento de carcaça), RIT (ritmo) e Recepção = "aguardando dados" (RD-51 — §3: peso vivo pendente).
import { Factory } from 'lucide-react'
import { PainelAmbito } from '@/components/inteligencia/PainelAmbito'

export default function AbateBIPage() {
  return (
    <PainelAmbito
      ambito="abate"
      titulo="Produção · Abate"
      subtitulo="Cabeças · carcaça · arrobas · rastreio — do canônico de abate"
      icone={<Factory size={20} />}
      tiers={[
        { titulo: 'Rendimento de carcaça (REN)', motivo: 'Aguardando o peso vivo na recepção/compra — sem ele o % carcaça/vivo não fecha (§3).' },
        { titulo: 'Ritmo de abate (cab/h)', motivo: 'Aguardando hora de início/fim consolidada por turno no evento de abate.' },
        { titulo: 'Recepção (QPA · TDP · TCR · OBA)', motivo: 'Aguardando os dados de entrada de gado (curral, jejum, mortes).' },
      ]}
    />
  )
}
