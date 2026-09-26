// #59 · listas do contrato compartilhadas pela solicitação (SolicitarContratoModal) e pela elaboração
// (ContratoFeeModal). Mesmos valores gravados pelo ContratoForm da GE (periodicidade/tipo_reajuste);
// a forma de pagamento vem da fonte única do financeiro (FORMAS_PAGAMENTO).
import type { CSSProperties } from 'react'
import type { Opcao } from '@/lib/financeiro/formasPagamento'

export { FORMAS_PAGAMENTO } from '@/lib/financeiro/formasPagamento'

export const PERIODICIDADES_CONTRATO: Opcao[] = [
  { v: 'mensal', l: 'Todo mês' },
  { v: 'bimestral', l: 'A cada 2 meses' },
  { v: 'trimestral', l: 'A cada 3 meses' },
  { v: 'semestral', l: 'A cada 6 meses' },
  { v: 'anual', l: 'Uma vez por ano' },
]

export const TIPOS_REAJUSTE_CONTRATO: Opcao[] = [
  { v: 'nenhum', l: 'Sem reajuste' },
  { v: 'ipca', l: 'Anual IPCA' },
  { v: 'igpm', l: 'Anual IGPM' },
  { v: 'personalizado', l: 'Personalizado (%)' },
]

// grade que vira 1 coluna no celular
export const gradeContrato: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }
