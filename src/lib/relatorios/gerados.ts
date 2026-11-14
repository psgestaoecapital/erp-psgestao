// Fonte ÚNICA da verdade dos relatórios em segundo plano que o sistema REALMENTE entrega.
// Antes, a tela (page.tsx) oferecia 5 tipos + 2 formatos, mas o gerador (api/relatorios/fila/route.ts)
// só monta 3 tipos em Excel — selecionar DRE / Fluxo de caixa / PDF virava "beco sem saída": o pedido
// era aceito, o toast dizia SUCESSO e depois virava "erro" silencioso (PDCA GE, auditor_pdca_2).
// Para nunca mais divergir, a tela deriva as opções DESTA lista e o route.ts valida por ela.
// Ao implementar um novo gerador (ex.: DRE, Fluxo de caixa, PDF), acrescente aqui — num só lugar —
// e a opção aparece na tela automaticamente.

export type FormatoRelatorio = 'excel' | 'pdf'

/** Tipos cujo gerador em segundo plano já existe fim-a-fim. */
export const RELATORIOS_GERADOS: { id: string; nome: string }[] = [
  { id: 'financeiro_movimentacao', nome: 'Movimentação financeira' },
  { id: 'financeiro_pagar', nome: 'Contas a pagar' },
  { id: 'financeiro_receber', nome: 'Contas a receber' },
]

/** Formatos cujo gerador já existe. Hoje só Excel; PDF entra aqui quando houver gerador. */
export const FORMATOS_GERADOS: { id: FormatoRelatorio; nome: string }[] = [
  { id: 'excel', nome: 'Excel' },
]

export const TIPOS_GERADOS_IDS: ReadonlySet<string> = new Set(RELATORIOS_GERADOS.map((t) => t.id))
export const FORMATOS_GERADOS_IDS: ReadonlySet<string> = new Set(FORMATOS_GERADOS.map((f) => f.id))

/** True quando o par (tipo, formato) tem gerador — mesma regra usada pela tela e pelo worker da fila. */
export function relatorioEhGerado(tipo: string, formato: string): boolean {
  return TIPOS_GERADOS_IDS.has(tipo) && FORMATOS_GERADOS_IDS.has(formato)
}
