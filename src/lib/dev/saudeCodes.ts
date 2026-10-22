// Regra pura do card "Saúde dos Codes" (aba Codes): traduz o status de fn_codes_saude() em semáforo.
export type SaudeCode = {
  code: string
  status: 'trabalhando' | 'na fila' | 'TRAVADO' | 'ocioso' | string
  lease_ativa: boolean
  tarefas_recentes: number
  mais_antiga_recente_min: number | null
  backlog_antigo: number
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
