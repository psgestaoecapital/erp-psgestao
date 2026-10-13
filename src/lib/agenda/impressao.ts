// Triches #133 · impressão da agenda da oficina (para quem não usa tablet: imprime e deixa exposto aos mecânicos).
// Semanal ou do dia, de todos ou de um mecânico só. Regra pura: filtra, agrupa por dia e ordena por horário
// (sem horário vai por último no dia); agendamentos cancelados/não compareceu não saem na folha.
export type AgImpressao = {
  id: string; data: string; hora_inicio: string | null; hora_fim: string | null; status: string
  cliente_nome: string | null; responsavel_nome: string | null; titulo: string | null
  dados: { placa?: string; veiculo?: string; defeito?: string } | null; observacao: string | null
}

const FORA_DA_FOLHA = new Set(['cancelado', 'nao_compareceu'])

export const nomeMecanico = (a: { responsavel_nome: string | null }) => (a.responsavel_nome ?? '').trim() || 'Sem mecânico'

// mecânicos presentes no período (para o seletor), em ordem alfabética
export function mecanicosDoPeriodo(ags: AgImpressao[]): string[] {
  return Array.from(new Set(ags.filter((a) => !FORA_DA_FOLHA.has(a.status)).map(nomeMecanico))).sort((x, y) => x.localeCompare(y, 'pt-BR'))
}

export function diasParaImpressao(ags: AgImpressao[], dias: string[], mecanico: string): { dia: string; itens: AgImpressao[] }[] {
  const doMecanico = (a: AgImpressao) => !mecanico || nomeMecanico(a) === mecanico
  return dias.map((dia) => ({
    dia,
    itens: ags
      .filter((a) => a.data === dia && !FORA_DA_FOLHA.has(a.status) && doMecanico(a))
      .sort((a, b) => (a.hora_inicio ?? '99:99').localeCompare(b.hora_inicio ?? '99:99')),
  }))
}
