// Hub · Mão de obra — a MESMA conta de public.fn_mao_obra_custo_calcular (migration 20261002100000). A tela usa esta
// para mostrar o custo enquanto a pessoa digita; o banco usa a dele para a média da função e para o catálogo. O teste
// de aceitação confere que as duas dão o mesmo número.
// CLT:      base = salário + adicionais; remuneração = base × (1 + 13º + férias); encargos = remuneração × encargos
//           da folha; rescisão = base × provisão; mensal = remuneração + encargos + rescisão + benefícios.
// PJ:       mensal = valor mensal (ou valor/hora × horas) + benefícios; por m² → só custo do m².
// Diarista: mensal = diária × dias + benefícios.
// Hora produtiva = mensal ÷ horas produtivas. Exemplo da SPEC (Lucro Real, 36,8%): R$ 2.800 → R$ 5.487 → R$ 31,18/h.

export type Vinculo = 'clt' | 'pj' | 'diarista'
export type FormaPagamento = 'mensal' | 'hora' | 'm2' | 'diaria'

export interface FichaCusto {
  vinculo: Vinculo
  forma_pagamento: FormaPagamento
  salario: number
  valor_unidade: number
  dias_mes: number
  adicional_insalubridade: number
  adicional_periculosidade: number
  adicional_outros: number
  beneficio_vt: number
  beneficio_alimentacao: number
  beneficio_saude: number
  beneficio_seguro: number
  beneficio_epi: number
  horas_produtivas_mes: number
}

export interface Encargos {
  provisorio: boolean
  regime: 'simples' | 'presumido' | 'real'
  simples_anexo: string | null
  inss_patronal_pct: number
  rat_pct: number
  fap: number
  terceiros_pct: number
  fgts_pct: number
  desoneracao: boolean
  desoneracao_fator_folha: number
  cprb_pct: number | null
  prov_13_pct: number
  prov_ferias_pct: number
  prov_rescisao_pct: number
  encargos_folha_pct: number
}

export interface ResultadoCusto {
  base: number
  remuneracao: number
  encargos: number
  rescisao: number
  beneficios: number
  custo_mensal: number | null
  custo_hora: number | null
  custo_m2: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }

/** Encargos da folha (%) = INSS patronal × fator da folha (desoneração) + RAT × FAP + terceiros + FGTS. */
export function encargosFolhaPct(e: Pick<Encargos, 'inss_patronal_pct' | 'desoneracao_fator_folha' | 'rat_pct' | 'fap' | 'terceiros_pct' | 'fgts_pct'>): number {
  return Math.round((num(e.inss_patronal_pct) * num(e.desoneracao_fator_folha, 1) + num(e.rat_pct) * num(e.fap, 1) + num(e.terceiros_pct) + num(e.fgts_pct)) * 10000) / 10000
}

export function calcularCustoMaoObra(f: Partial<FichaCusto>, e: Pick<Encargos, 'prov_13_pct' | 'prov_ferias_pct' | 'prov_rescisao_pct' | 'encargos_folha_pct'>): ResultadoCusto {
  const vinc = f.vinculo ?? 'clt'
  const forma = f.forma_pagamento ?? 'mensal'
  const sal = num(f.salario)
  const vu = num(f.valor_unidade)
  const dias = num(f.dias_mes, 22)
  const horas = num(f.horas_produtivas_mes, 176) || null
  const adic = num(f.adicional_insalubridade) + num(f.adicional_periculosidade) + num(f.adicional_outros)
  const ben = num(f.beneficio_vt) + num(f.beneficio_alimentacao) + num(f.beneficio_saude) + num(f.beneficio_seguro) + num(f.beneficio_epi)
  const p13 = num(e.prov_13_pct, 8.33), pfer = num(e.prov_ferias_pct, 11.11), presc = num(e.prov_rescisao_pct, 4), encp = num(e.encargos_folha_pct, 36.8)
  let base: number, remun: number, enc: number, resc: number, mensal: number | null
  if (vinc === 'clt') {
    base = sal + adic
    remun = base * (1 + (p13 + pfer) / 100)
    enc = remun * encp / 100
    resc = base * presc / 100
    mensal = remun + enc + resc + ben
  } else if (vinc === 'diarista') {
    base = vu; remun = vu * dias; enc = 0; resc = 0; mensal = remun + ben
  } else {
    base = sal; remun = sal; enc = 0; resc = 0
    mensal = forma === 'hora' ? vu * (horas ?? 0) : forma === 'm2' ? null : sal
    if (mensal !== null) mensal += ben
  }
  const hora = vinc === 'pj' && forma === 'hora' ? vu : (mensal === null || horas === null ? null : mensal / horas)
  const m2 = forma === 'm2' ? vu : null
  return {
    base: r2(base), remuneracao: r2(remun), encargos: r2(enc), rescisao: r2(resc), beneficios: r2(ben),
    custo_mensal: mensal === null ? null : r2(mensal), custo_hora: hora === null ? null : r2(hora), custo_m2: m2 === null ? null : r2(m2),
  }
}

/** Reoneração gradual da folha (Lei 14.973/2024): parte do INSS patronal que volta à folha, por ano. */
export function fatorFolhaReoneracao(ano: number): number {
  if (ano <= 2024) return 0
  if (ano === 2025) return 0.25
  if (ano === 2026) return 0.5
  if (ano === 2027) return 0.75
  return 1
}
