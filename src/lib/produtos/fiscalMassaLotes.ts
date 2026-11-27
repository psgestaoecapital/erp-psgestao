// Chamado #11065 — Edição fiscal em massa / Padrão fiscal por NCM em LOTES.
// A prévia só conta; a aplicação roda em passos curtos (um lote por chamada, cada um numa transação própria) para nunca
// estourar o tempo do banco (8 s para o usuário logado). Este módulo é puro (sem React, sem Supabase): recebe a função
// que chama o banco, então o gate e os testes conseguem exercitá-lo.

export type StatusLote = 'pendente' | 'processando' | 'concluido' | 'erro' | 'cancelado'

export type LoteFiscal = {
  id: string
  lote_id: string
  status: StatusLote
  total_alvo: number
  total_mudam: number
  processados: number
  produtos_alterados: number
  campos_alterados: number
  percentual: number
  tamanho_lote: number
  tentativas: number
  erro: string | null
  ultimo_passo_ms: number | null
  criado_em: string
  atualizado_em: string
}

export type RespostaPasso = { ok: boolean; erro?: string; mensagem?: string; ocupado?: boolean; job?: LoteFiscal | null }

export type ChamarPasso = (jobId: string, retentar: boolean) => Promise<RespostaPasso>

export const EM_ANDAMENTO: readonly StatusLote[] = ['pendente', 'processando']

export function emAndamento(job: Pick<LoteFiscal, 'status'> | null | undefined): boolean {
  return !!job && EM_ANDAMENTO.includes(job.status)
}

/** Texto curto do andamento, em linguagem do usuário. */
export function textoAndamento(job: LoteFiscal): string {
  const n = (v: number) => v.toLocaleString('pt-BR')
  switch (job.status) {
    case 'concluido':
      return `Concluído: ${n(job.produtos_alterados)} produtos alterados (${n(job.campos_alterados)} campos) de ${n(job.total_alvo)} verificados.`
    case 'cancelado':
      return `Cancelado em ${n(job.processados)} de ${n(job.total_alvo)}. O que já foi gravado fica registrado; reaplicar continua de onde parou.`
    case 'erro':
      return `Parou em ${n(job.processados)} de ${n(job.total_alvo)}: ${job.erro ?? 'erro no lote'}. Toque em "Continuar" para tentar de novo.`
    default:
      return `Aplicando… ${n(job.processados)} de ${n(job.total_alvo)} produtos (${job.percentual}%).`
  }
}

export type OpcoesCondutor = {
  /** chamado a cada passo concluído (barra de progresso) */
  aoProgredir: (job: LoteFiscal) => void
  /** devolve true para parar (botão Cancelar / modal fechado) */
  deveParar?: () => boolean
  /** espera entre passos quando outro processo está no lote (ms) */
  esperaOcupado?: number
  /** limite de passos (rede de segurança contra laço infinito) */
  maxPassos?: number
  dormir?: (ms: number) => Promise<void>
}

export type ResultadoCondutor = { job: LoteFiscal | null; motivo: 'terminou' | 'parado' | 'erro' | 'limite' }

/**
 * Chama o passo do servidor em sequência até o lote terminar. Cada chamada processa UM lote e commita sozinha:
 * se a rede cair ou a aba fechar, nada se perde (o servidor continua pelo agendador e a tela retoma pelo estado).
 */
export async function conduzirLote(jobId: string, chamar: ChamarPasso, op: OpcoesCondutor, retentarNoInicio = false): Promise<ResultadoCondutor> {
  const dormir = op.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const max = op.maxPassos ?? 2000
  let ultimo: LoteFiscal | null = null
  let retentar = retentarNoInicio
  for (let i = 0; i < max; i++) {
    if (op.deveParar?.()) return { job: ultimo, motivo: 'parado' }
    const r = await chamar(jobId, retentar)
    retentar = false
    if (!r.ok && !r.job) return { job: ultimo, motivo: 'erro' }
    if (r.job) {
      ultimo = r.job
      op.aoProgredir(r.job)
      if (!emAndamento(r.job)) return { job: r.job, motivo: r.job.status === 'erro' ? 'erro' : 'terminou' }
    }
    // outro processo (o agendador do servidor) está no lote: só acompanha
    if (r.ocupado) await dormir(op.esperaOcupado ?? 1500)
  }
  return { job: ultimo, motivo: 'limite' }
}

/** Mensagem do servidor → texto de tela (nunca erro cru do banco). */
export function mensagemDoErro(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '')
  if (/statement timeout|canceling statement/i.test(m)) return 'O banco demorou a responder. Nada foi perdido: toque em "Continuar" para seguir de onde parou.'
  if (/login obrigat/i.test(m)) return 'Sua sessão expirou. Entre de novo e tente outra vez.'
  if (/sem acesso/i.test(m)) return 'Você não tem acesso a esta empresa.'
  return m || 'Não foi possível concluir agora. Tente de novo.'
}
