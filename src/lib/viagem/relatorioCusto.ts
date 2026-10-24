// Contrato de dados do relatório de custo de viagem (por viagem e por obra) — fn_viagem_relatorio_custo
// (migration 20261025020052). O banco é o juiz: a tela só lê esta função e mostra; nada de conta paralela (RD-35).
// As regras puras abaixo são as MESMAS da função, para o gate provar o cálculo sem rede.

export type ViagemObraRateio = {
  obra_id: string; obra_numero: string | null; obra_nome: string | null
  custo: number; km_rateado: number | null; participacao_pct: number | null
}

export type ViagemCusto = {
  viagem_id: string; numero: number; colaborador: string; placa: string | null
  status: 'aberta' | 'fechada'; periodo_inicio: string; periodo_fim: string
  origem: string | null; destino: string | null; obra_principal_id: string
  custo: number; total_despesas: number; total_abastecimentos: number
  km_rodado: number | null; litros: number; media_km_l: number | null; custo_km: number | null
  adiantamento: number; pago_colaborador: number; saldo: number
  saldo_texto: 'colaborador devolve à empresa' | 'empresa reembolsa o colaborador' | 'acertado'
  lancamentos: number; por_obra: ViagemObraRateio[]
}

export type ObraCustoViagem = {
  obra_id: string; obra_numero: string | null; obra_nome: string | null
  custo: number; km_rateado: number | null; custo_km: number | null; viagens: number; lancamentos: number
  por_categoria: { categoria: string; descricao: string | null; custo: number }[]
}

export type ConferenciaObra = {
  obra_id: string; obra_numero: string | null; obra_nome: string | null
  relatorio: number; resultado: number; diferenca: number
}

export type RelatorioCustoViagem =
  | { ok: false; erro: string }
  | {
      ok: true
      filtros: { company_id: string; obra_id: string | null; inicio: string | null; fim: string | null }
      totais: { viagens: number; custo: number; km_rodado: number | null; custo_km: number | null; obras: number }
      viagens: ViagemCusto[]
      obras: ObraCustoViagem[]
      conferencia: { escopo: string; bate: boolean; obras: ConferenciaObra[] }
    }

// Chamada única da tela (gilberto-esteira): p_obra_id/p_inicio/p_fim opcionais.
export const RPC_RELATORIO_CUSTO_VIAGEM = 'fn_viagem_relatorio_custo'

// Chaves de ajuda ("?", RD-95) dos campos do relatório.
export const AJUDA_RELATORIO_CUSTO = {
  filtroObra: 'projetos.viagem.rel_filtro_obra',
  filtroPeriodo: 'projetos.viagem.rel_filtro_periodo',
  custoViagem: 'projetos.viagem.rel_custo_viagem',
  kmRodado: 'projetos.viagem.rel_km_rodado',
  custoKm: 'projetos.viagem.rel_custo_km',
  kmRateado: 'projetos.viagem.rel_km_rateado',
  custoObra: 'projetos.viagem.rel_custo_obra',
  participacao: 'projetos.viagem.rel_participacao',
  conferencia: 'projetos.viagem.rel_conferencia',
} as const

const r = (n: number, casas: number) => { const f = 10 ** casas; return Math.round((n + Number.EPSILON) * f) / f }

// km rodado = final − inicial (só com os dois e final ≥ inicial)
export function kmRodado(kmInicial: number | null, kmFinal: number | null): number | null {
  return kmInicial != null && kmFinal != null && kmFinal >= kmInicial ? kmFinal - kmInicial : null
}

// custo por km = custo ÷ km (sem km, não há custo por km)
export function custoPorKm(custo: number, km: number | null): number | null {
  return km != null && km > 0 ? r(custo / km, 2) : null
}

// rateio de uma viagem entre obras: cada cupom tem a sua obra; o km segue o dinheiro
export function ratearViagem(lancamentos: { obra_id: string; valor: number }[], km: number | null) {
  const total = r(lancamentos.reduce((s, l) => s + l.valor, 0), 2)
  const porObra = new Map<string, number>()
  for (const l of lancamentos) porObra.set(l.obra_id, (porObra.get(l.obra_id) ?? 0) + l.valor)
  return [...porObra.entries()].map(([obra_id, v]) => ({
    obra_id,
    custo: r(v, 2),
    km_rateado: km != null && total > 0 ? r(km * v / total, 1) : null,
    participacao_pct: total > 0 ? r(100 * v / total, 2) : null,
  })).sort((a, b) => b.custo - a.custo)
}
