export interface LinhaNegocio {
  id: string
  empresa_id: string
  nome: string
  descricao?: string
  cor: string
  ativo: boolean
  ordem: number
  created_at: string
  updated_at: string
}

export interface LinhaNegocioBudget {
  id: string
  linha_id: string
  empresa_id: string
  ano: number
  mes: number
  receita_budget: number
  despesa_budget: number
}

export interface LinhaNegocioRateio {
  id: string
  empresa_id: string
  categoria: string
  linha_id: string
  percentual: number
  criterio: 'manual' | 'faturamento' | 'headcount' | 'area'
}

export interface DREPorLinha {
  linha_id: string
  linha_nome: string
  linha_cor: string
  receita_bruta: number
  custos_diretos: number
  cm1: number
  cm1_pct: number
  despesas_comerciais: number
  cm2: number
  cm2_pct: number
  overhead_rateado: number
  cm3: number
  cm3_pct: number
  budget_receita?: number
  budget_despesa?: number
  desvio_pct?: number
  health_score?: number
}

export interface BenchmarkLinhas {
  linhas: DREPorLinha[]
  consolidado: {
    receita_total: number
    cm3_total: number
    cm3_pct_media: number
    melhor_linha: string
    pior_linha: string
  }
}
