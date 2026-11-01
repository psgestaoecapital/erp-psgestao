// Plano de Ação 5W2H — regras puras (a tela e o gate usam as mesmas).
export type StatusAcao = 'aberta' | 'em_andamento' | 'concluida' | 'cancelada'
export const STATUS: { id: StatusAcao; nome: string }[] = [
  { id: 'aberta', nome: 'Aberta' }, { id: 'em_andamento', nome: 'Em andamento' },
  { id: 'concluida', nome: 'Concluída' }, { id: 'cancelada', nome: 'Cancelada' },
]
export const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export type AcaoBase = { status: StatusAcao; quando: string | null }
export const hojeISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

/** "atrasada" não é gravada: é calculada (prazo vencido e ainda não encerrada). */
export function atrasada(a: AcaoBase, hoje = hojeISO()): boolean {
  return (a.status === 'aberta' || a.status === 'em_andamento') && !!a.quando && a.quando < hoje
}
/** Pauta da próxima reunião de uma rotina = pendências abertas (aberta/em andamento) dela. */
export const pendente = (a: AcaoBase) => a.status === 'aberta' || a.status === 'em_andamento'
export function diasParaPrazo(a: AcaoBase, hoje = hojeISO()): number | null {
  if (!a.quando) return null
  return Math.round((Date.parse(a.quando) - Date.parse(hoje)) / 86_400_000)
}
export const vencendo = (a: AcaoBase, hoje = hojeISO()) => { const d = diasParaPrazo(a, hoje); return pendente(a) && d !== null && d >= 0 && d <= 2 }
export const dataBR = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')
export const reais = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
