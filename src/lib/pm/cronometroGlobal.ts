// PM-T (1) · cronômetro onde o trabalho acontece (CEO 06/10, blueprint 00.5-B). Um ativo por pessoa: a linha do
// agency_timesheet com fim_em vazio. Iniciar em outro job para o anterior antes. Os botões ▶ dos cartões e a barra
// global do topo falam entre si pelo evento EVENTO_CRONOMETRO (sem tabela nova).
import { supabase } from '@/lib/supabase'
import { horasDoCronometro } from '@/lib/pm/meuDia'

export const EVENTO_CRONOMETRO = 'pm:cronometro'
export type CronometroAberto = { id: string; job_id: string | null; inicio_em: string }

export const avisarCronometro = () => { invalidarLeituraCronometro(); if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_CRONOMETRO)) }

// P1 17/10 (laço de requisições em agency_timesheet): cada cartão de job monta um useCronometroAberto e cada um lia o banco
// sozinho (N cartões × cada evento). Agora a leitura é COMPARTILHADA por pessoa: chamadas simultâneas dividem 1 requisição,
// o resultado vale por INTERVALO_MIN_LEITURA_MS e só avisarCronometro (início/parada real) invalida. Disjuntor: mais de
// LIMITE_LEITURAS_MIN leituras reais por minuto → devolve o último valor, avisa no console e não consulta o banco.
export const INTERVALO_MIN_LEITURA_MS = 3000
export const LIMITE_LEITURAS_MIN = 20
type Leitura = { userId: string; em: number; valor: CronometroAberto | null; voo: Promise<CronometroAberto | null> | null }
let leitura: Leitura | null = null
let janela: number[] = []
export function invalidarLeituraCronometro() { if (leitura) leitura.em = 0 }
export function _zerarLeituraCronometro() { leitura = null; janela = [] }

export async function lerCronometroAberto(userId: string): Promise<CronometroAberto | null> {
  const agora = Date.now()
  if (leitura && leitura.userId === userId) {
    if (leitura.voo) return leitura.voo
    if (agora - leitura.em < INTERVALO_MIN_LEITURA_MS) return leitura.valor
  }
  janela = janela.filter((t) => agora - t < 60_000)
  if (janela.length >= LIMITE_LEITURAS_MIN) {
    if (janela.length === LIMITE_LEITURAS_MIN) { janela.push(agora); console.warn('[pm] cronômetro: laço de leituras interrompido (limite por minuto); usando o último valor') }
    return leitura && leitura.userId === userId ? leitura.valor : null
  }
  janela.push(agora)
  const atual: Leitura = { userId, em: agora, valor: leitura?.userId === userId ? leitura.valor : null, voo: null }
  atual.voo = (async () => {
    try {
      const { data } = await supabase.from('agency_timesheet').select('id, job_id, inicio_em').eq('user_id', userId).is('fim_em', null).maybeSingle()
      atual.valor = (data as CronometroAberto | null) ?? null
      return atual.valor
    } finally { atual.voo = null; atual.em = Math.max(atual.em, Date.now() - 1) }
  })()
  leitura = atual
  return atual.voo
}

// Para o aberto gravando as horas (mínimo 0,01 h). Devolve as horas ou o erro.
export async function pararCronometro(aberto: CronometroAberto, fimEm?: Date): Promise<{ horas?: number; erro?: string }> {
  const fim = fimEm ?? new Date()
  const horas = horasDoCronometro(aberto.inicio_em, fim)
  const { error } = await supabase.from('agency_timesheet').update({ fim_em: fim.toISOString(), horas }).eq('id', aberto.id)
  if (error) return { erro: error.message }
  avisarCronometro()
  return { horas }
}

// Inicia no job; se já há um aberto (em outro job), para antes. No mesmo job não faz nada.
export async function iniciarCronometro(empresa: string, userId: string, jobId: string): Promise<{ erro?: string }> {
  const aberto = await lerCronometroAberto(userId)
  if (aberto?.job_id === jobId) return {}
  if (aberto) { const r = await pararCronometro(aberto); if (r.erro) return { erro: r.erro } }
  // LGPD (20261005180000): o custo/hora nasce no servidor (gatilho trg_agency_timesheet_custo_auto) — o cliente não grava custo_hora
  const ini = new Date()
  const { error } = await supabase.from('agency_timesheet').insert({
    company_id: empresa, job_id: jobId, user_id: userId, data: ini.toISOString().slice(0, 10), horas: 0,
    inicio_em: ini.toISOString(), descricao: 'cronômetro',
  })
  if (error) return { erro: error.message }
  avisarCronometro()
  return {}
}

// PM-T (4c) · total de horas já apontadas no job (todas as pessoas); linha aberta conta como horas > 0 só se fechada.
export async function totalHorasDoJob(jobId: string): Promise<number> {
  const { data } = await supabase.from('agency_timesheet').select('horas').eq('job_id', jobId)
  return (data ?? []).reduce((s: number, r: { horas: number | null }) => s + Number(r.horas ?? 0), 0)
}
