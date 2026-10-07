// PM-T (1) · cronômetro onde o trabalho acontece (CEO 06/10, blueprint 00.5-B). Um ativo por pessoa: a linha do
// agency_timesheet com fim_em vazio. Iniciar em outro job para o anterior antes. Os botões ▶ dos cartões e a barra
// global do topo falam entre si pelo evento EVENTO_CRONOMETRO (sem tabela nova).
import { supabase } from '@/lib/supabase'
import { horasDoCronometro } from '@/lib/pm/meuDia'

export const EVENTO_CRONOMETRO = 'pm:cronometro'
export type CronometroAberto = { id: string; job_id: string | null; inicio_em: string }

export const avisarCronometro = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_CRONOMETRO)) }

export async function lerCronometroAberto(userId: string): Promise<CronometroAberto | null> {
  const { data } = await supabase.from('agency_timesheet').select('id, job_id, inicio_em').eq('user_id', userId).is('fim_em', null).maybeSingle()
  return (data as CronometroAberto | null) ?? null
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
  const { data: eq } = await supabase.from('agency_equipe').select('custo_hora').eq('company_id', empresa).eq('user_id', userId).maybeSingle()
  const ini = new Date()
  const { error } = await supabase.from('agency_timesheet').insert({
    company_id: empresa, job_id: jobId, user_id: userId, data: ini.toISOString().slice(0, 10), horas: 0,
    inicio_em: ini.toISOString(), custo_hora: (eq as { custo_hora: number | null } | null)?.custo_hora ?? null, descricao: 'cronômetro',
  })
  if (error) return { erro: error.message }
  avisarCronometro()
  return {}
}
