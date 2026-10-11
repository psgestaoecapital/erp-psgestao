// P&M · Painel do gestor (PM-T 5, blueprint 00.5-B): cobertura de apontamento, jobs sem horas e alerta de 80% do estimado.
// Regras puras, sem rede. Não usa custo: só horas (custo é restrito a quem tem direito, #2031).
import { concluido, hojeISO, legado, type JobPainel } from './painel'

export const LIMITE_ALERTA = 0.8
export interface HoraDia { user_id: string | null; data: string; horas: number | null }
export interface Pessoa { id: string; nome: string }

const num = (n: number | null | undefined) => (typeof n === 'number' && isFinite(n) ? n : 0)
const aberto = (j: JobPainel, hoje: string) => !concluido(j) && !legado(j, hoje)

export interface Cobertura { id: string; nome: string; horas: number; dias: number; semApontar: boolean }
/** Horas e dias com apontamento por pessoa na janela [de, ate]; semApontar = nenhuma hora na janela. */
export function cobertura(pessoas: Pessoa[], horas: HoraDia[], de: string, ate: string): Cobertura[] {
  return pessoas.map((p) => {
    const mine = horas.filter((h) => h.user_id === p.id && h.data >= de && h.data <= ate && num(h.horas) > 0)
    return { id: p.id, nome: p.nome, horas: Math.round(mine.reduce((s, h) => s + num(h.horas), 0) * 100) / 100, dias: new Set(mine.map((h) => h.data)).size, semApontar: mine.length === 0 }
  }).sort((a, b) => Number(b.semApontar) - Number(a.semApontar) || a.horas - b.horas)
}

/** Jobs em andamento (não concluídos, fora do legado) sem nenhuma hora realizada. */
export function jobsSemHoras(jobs: JobPainel[], hoje = hojeISO()): JobPainel[] {
  return jobs.filter((j) => aberto(j, hoje) && num(j.horas_realizadas) <= 0)
}

export interface AlertaEstimado { job: JobPainel; pct: number; estourou: boolean }
/** Jobs abertos com estimado > 0 e realizado >= 80% dele (estourou = 100% ou mais). */
export function alertasEstimado(jobs: JobPainel[], hoje = hojeISO()): AlertaEstimado[] {
  return jobs
    .filter((j) => aberto(j, hoje) && num(j.horas_estimadas) > 0 && num(j.horas_realizadas) / num(j.horas_estimadas) >= LIMITE_ALERTA)
    .map((j) => { const pct = Math.round((num(j.horas_realizadas) / num(j.horas_estimadas)) * 100); return { job: j, pct, estourou: pct >= 100 } })
    .sort((a, b) => b.pct - a.pct)
}

export const janelaDias = (dias: number, hoje = hojeISO()) => {
  const d = new Date(`${hoje}T12:00:00`); d.setDate(d.getDate() - (dias - 1))
  return { de: d.toISOString().slice(0, 10), ate: hoje }
}
