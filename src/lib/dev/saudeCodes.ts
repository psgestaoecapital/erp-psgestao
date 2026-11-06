// Regra pura do card "Saúde dos Codes" (aba Codes): traduz o status de fn_codes_saude() em semáforo.
export type SaudeCode = {
  code: string
  status: 'trabalhando' | 'na fila' | 'TRAVADO' | 'ocioso' | string
  lease_ativa: boolean
  tarefas_recentes: number
  mais_antiga_recente_min: number | null
  backlog_antigo: number
  ultima_sessao_em?: string | null
  encerrou_normalmente?: boolean
  trabalho_pendente?: boolean
  prs_paradas?: number
  plantao_min?: number | null
}
export type SemaforoCode = 'verde' | 'amarelo' | 'vermelho'

// verde = trabalhando ou na fila · amarelo = ocioso · vermelho = TRAVADO (status desconhecido também alerta)
export function semaforoCode(s: Pick<SaudeCode, 'status'>): SemaforoCode {
  const st = (s.status ?? '').toLowerCase()
  if (st === 'trabalhando' || st === 'na fila') return 'verde'
  if (st === 'ocioso') return 'amarelo'
  return 'vermelho'
}

// vermelhos primeiro, depois amarelos, depois verdes; empate pelo nome
export function ordenarSaude(l: SaudeCode[]): SaudeCode[] {
  const peso: Record<SemaforoCode, number> = { vermelho: 0, amarelo: 1, verde: 2 }
  return [...l].sort((a, b) => peso[semaforoCode(a)] - peso[semaforoCode(b)] || a.code.localeCompare(b.code))
}

// Resumo do dono da esteira (fn_dev_esteira_dono_resumo) — mostrado dentro do cartão do gilberto-esteira.
export type DonoEsteira = {
  min_sem_publicar: number | null
  acordado_hoje: number
  publicacoes_destravadas_24h: number
  ultima_anotacao: { em: string; texto: string } | null
}
export const CODE_DONO_ESTEIRA = 'gilberto-esteira'

// Regra de status de fn_codes_saude() (espelho em TS, para o gate provar os três casos):
// trabalhando = sessão renovada há < 12 min · encerrou normalmente = renovada_em < iniciada_em (a vez é liberada de propósito)
// TRAVADO só com trabalho pendente (tarefa aberta ou PR parada) E plantão sem atualização há mais de 30 min.
export function statusSaude(f: { renovada_min: number | null; encerrou_normalmente: boolean; trabalho_pendente: boolean; plantao_min: number | null }): string {
  if (f.renovada_min != null && f.renovada_min < 12 && !f.encerrou_normalmente) return 'trabalhando'
  if (!f.trabalho_pendente) return 'ocioso'
  if (f.plantao_min == null || f.plantao_min > 30) return 'TRAVADO'
  return 'na fila'
}
