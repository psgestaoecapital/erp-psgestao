// Margem por Job (P&M) — regra pura, sem supabase (testável no gate).
// CEO 01/10: sem custo/hora da pessoa, o custo das horas fica R$ 0 e a tela mostrava "lucro = valor" (falso).
// Agora: hora apontada por quem não tem custo/hora → "cadastre o custo da hora da equipe"; job sem nenhum custo
// (sem apontamento e sem custo estimado) → "sem custo lançado". Nos dois casos NÃO há lucro/margem, e o job não
// entra no lucro total (RD-51: pendência não vira número bonito).

export type JobMargem = { id: string; valor_job: number | null; custo_estimado: number | null }
export type ApontamentoMargem = { job_id: string | null; horas: number | null; custo_hora: number | null; custo_total: number | null }

/** Totais por job de fn_pm_custo_jobs (LGPD: a tela não lê o custo de cada pessoa). */
export type TotalJob = { job_id: string; horas: number | null; horas_sem_custo: number | null; custo: number | null }

/** Converte os totais por job em apontamentos equivalentes (horas com custo + horas sem custo) para a mesma regra. */
export function apontamentosDosTotais(totais: TotalJob[]): ApontamentoMargem[] {
  const out: ApontamentoMargem[] = []
  for (const t of totais) {
    const horas = Number(t.horas ?? 0), sem = Number(t.horas_sem_custo ?? 0), custo = Number(t.custo ?? 0)
    const com = Math.max(0, horas - sem)
    if (com > 0) out.push({ job_id: t.job_id, horas: com, custo_hora: com > 0 ? custo / com : null, custo_total: custo })
    if (sem > 0) out.push({ job_id: t.job_id, horas: sem, custo_hora: null, custo_total: 0 })
  }
  return out
}

export type SituacaoMargem = 'ok' | 'sem_custo_hora' | 'sem_custo'

export type LinhaMargem = {
  situacao: SituacaoMargem
  valor: number
  custo: number
  estimado: boolean
  lucro: number | null
  margem: number | null
  horasSemCusto: number
}

export function calcularMargem(job: JobMargem, apontamentos: ApontamentoMargem[]): LinhaMargem {
  const doJob = apontamentos.filter((a) => a.job_id === job.id)
  const valor = Number(job.valor_job ?? 0)
  const horasSemCusto = doJob
    .filter((a) => Number(a.horas ?? 0) > 0 && !(Number(a.custo_hora ?? 0) > 0))
    .reduce((s, a) => s + Number(a.horas ?? 0), 0)
  const custoReal = doJob.reduce((s, a) => s + Number(a.custo_total ?? 0), 0)

  if (horasSemCusto > 0) {
    return { situacao: 'sem_custo_hora', valor, custo: custoReal, estimado: false, lucro: null, margem: null, horasSemCusto }
  }
  const estimado = !(custoReal > 0)
  const custo = estimado ? Number(job.custo_estimado ?? 0) : custoReal
  if (!(custo > 0)) {
    return { situacao: 'sem_custo', valor, custo: 0, estimado, lucro: null, margem: null, horasSemCusto: 0 }
  }
  const lucro = valor - custo
  return { situacao: 'ok', valor, custo, estimado, lucro, margem: valor > 0 ? (lucro / valor) * 100 : 0, horasSemCusto: 0 }
}

/** Totais só com os jobs de custo completo; os outros são contados à parte. */
export function totaisMargem(linhas: LinhaMargem[]) {
  const ok = linhas.filter((l) => l.situacao === 'ok')
  const valor = ok.reduce((s, l) => s + l.valor, 0)
  const custo = ok.reduce((s, l) => s + l.custo, 0)
  const lucro = valor - custo
  return {
    valor, custo, lucro,
    margem: valor > 0 ? (lucro / valor) * 100 : 0,
    semCustoHora: linhas.filter((l) => l.situacao === 'sem_custo_hora').length,
    semCusto: linhas.filter((l) => l.situacao === 'sem_custo').length,
  }
}
