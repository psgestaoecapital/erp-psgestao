// Regras puras do card "Fluxograma da Infra" (aba Codes): semáforo só de performance. Entrada = jsonb de fn_infra_fluxograma().
export type Cor = 'verde' | 'amarelo' | 'vermelho'
export type CodeInfra = { code: string; status: string; lease_ativa: boolean; backlog_antigo: number; tarefas_recentes: number }
export type FluxogramaInfra = {
  codes: CodeInfra[]; papeis: Record<string, string>
  esteira: { portao_verde: boolean | null; portao_spec_falha: string | null; merges_24h: number | null; intervalo_mediano_merge_min: number | null; fila_parada: number | null; fila_esperando: number | null }
  em_teste: number | null; esperando: number | null; ult_publicada_min: number | null; relogio_ativo: boolean | null; auditores_ativos: number | null
}

export function corPortao(f: FluxogramaInfra): Cor { return f.esteira.portao_verde === true ? 'verde' : 'vermelho' }
export function corCode(c: CodeInfra): Cor {
  if (c.status === 'travado') return 'vermelho'
  return c.status === 'trabalhando' || c.lease_ativa ? 'verde' : 'amarelo'
}
export function corPublicacao(min: number | null): Cor { return min === null || min > 90 ? 'vermelho' : min > 30 ? 'amarelo' : 'verde' }
export function corVigilancia(f: FluxogramaInfra): Cor { return f.relogio_ativo && (f.auditores_ativos ?? 0) > 0 ? 'verde' : f.relogio_ativo || (f.auditores_ativos ?? 0) > 0 ? 'amarelo' : 'vermelho' }
