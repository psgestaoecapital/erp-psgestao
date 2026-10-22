// Regras puras do bloco "Diagnóstico da Esteira" (aba Codes). Entrada = jsonb de fn_esteira_diagnostico(). Semáforo só de performance.
import type { Semaforo } from './saudeEsteira'

export const META_PUB_HORA = 4
export type VagaDiag = {
  vaga: number; ciclos_24h: number; abertas: number; ultimo_inicio: string | null; ultimo_fim: string | null; ultima_pr: number | null
  ultimo_motivo: string | null; ultimo_ciclo_s: number | null; mediana_ciclo_s: number | null; ciclos_curtos_24h: number
}
export type Diagnostico = {
  gerado_em: string; vagas: VagaDiag[]
  vazao: { pub_1h: number; pub_24h: number; mediana_pronta_pub_min: number | null; ultima_pub: string | null }
  presas: { pr_numero: number; vaga: number; min: number }[]
  duplicadas: { pr_numero: number; qtd: number; vagas: number[] }[]
  fila: { esperando: number; fora_da_rodada: number; fora: number }
  motivos: { motivo: string; n: number }[]
}

export function nomeVaga(v: number): string { return v === 0 ? 'Vaga 0' : v === 1 ? 'Vaga 1 (main)' : `Vaga ${v}` }

// ciclo < 5 min = preparo abortando (não é teste); 15–20 min = suíte rodando
export function classificarVaga(v: VagaDiag, presaMin: number): { sem: Semaforo; texto: string; causa: string | null } {
  const s = v.ultimo_ciclo_s
  // o motivo padrão da reserva ('reserva de vaga na triagem…') não é causa; causa nomeada só se a esteira gravar uma
  const m = v.ultimo_motivo?.trim() ?? ''
  const causa = m && !/^reserva de vaga/i.test(m) ? m : null
  if (presaMin > 90) return { sem: 'vermelho', texto: `reserva presa há ${Math.round(presaMin)} min`, causa }
  if (s === null) return { sem: 'verde', texto: v.ultimo_inicio ? 'ciclo em andamento' : 'sem ciclos', causa: null }
  if (s < 300) return { sem: 'amarelo', texto: `${s < 120 ? `${s}s` : `${Math.round(s / 60)} min`} · ABORTANDO`, causa: causa ?? 'preparo abortou (causa não registrada na reserva)' }
  return { sem: 'verde', texto: `${Math.round(s / 60)} min · OK`, causa: null }
}

export function classificarVazao(d: Diagnostico['vazao'], agora: Date) {
  const sem: Semaforo = d.pub_1h >= META_PUB_HORA ? 'verde' : d.pub_1h >= 1 ? 'amarelo' : 'vermelho'
  const haMin = d.ultima_pub ? Math.max(0, Math.round((agora.getTime() - new Date(d.ultima_pub).getTime()) / 60000)) : null
  return { sem, haMin }
}

export function classificarLeak(d: Diagnostico): Semaforo { return d.presas.length + d.duplicadas.length > 0 ? 'vermelho' : 'verde' }
