'use client'
// SPEC · BI Comercial — agora um WRAPPER FINO do motor GENÉRICO (fn_ind_ambito_painel, âmbito 'comercial').
// Migrado sem regressão (RD-55): mesmos números do piloto (CLI/KG/FAT/PMV/MIX sobre o canônico ind_venda),
// série + pivot por vendedor/supervisor/filial, aba Metas, escopo fail-closed. Tiers 2/3 "aguardando" (RD-51).
import { TrendingUp } from 'lucide-react'
import { PainelAmbito } from '@/components/inteligencia/PainelAmbito'

export default function ComercialBIPage() {
  return (
    <PainelAmbito
      ambito="comercial"
      titulo="Comercial"
      subtitulo="Volume · faturamento · clientes · concentração — do canônico de vendas"
      icone={<TrendingUp size={20} />}
      podeSync
      tiers={[
        { titulo: 'Por cidade / cliente (apelido)', motivo: 'Aguardando o cadastro de clientes no conector (Tier 2).' },
        { titulo: 'KG e R$/kg por produto', motivo: 'Aguardando o faturamento linha-a-linha (Tier 3).' },
      ]}
    />
  )
}
