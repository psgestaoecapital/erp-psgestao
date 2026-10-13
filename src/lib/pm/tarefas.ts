// Pdois #97/#98 · tarefas do lead — tipos e regras puras (sem banco), usadas pela tela e pelo gate.
export type TarefaTipo = 'ligar' | 'whatsapp' | 'reuniao' | 'visita' | 'email' | 'outro'
export type TarefaSituacao = 'a_fazer' | 'feita' | 'cancelada'
export type Tarefa = {
  id: string; company_id: string; lead_id: string | null; cliente_id: string | null
  tipo: TarefaTipo; titulo: string; data: string; hora: string | null
  responsavel_id: string | null; responsavel_nome: string | null
  situacao: TarefaSituacao; resultado: string | null; origem: string
}
export type LeadRef = { id: string; nome: string; empresa: string | null; contato_telefone: string | null }

export const TIPOS_TAREFA: Array<{ v: TarefaTipo; l: string; i: string }> = [
  { v: 'ligar', l: 'Ligar', i: '📞' },
  { v: 'whatsapp', l: 'WhatsApp', i: '💬' },
  { v: 'reuniao', l: 'Reunião', i: '🤝' },
  { v: 'visita', l: 'Agendar visita', i: '📍' },
  { v: 'email', l: 'E-mail', i: '✉️' },
  { v: 'outro', l: 'Outro', i: '📌' },
]
export const tipoTarefa = (t: string) => TIPOS_TAREFA.find((x) => x.v === t) ?? TIPOS_TAREFA[TIPOS_TAREFA.length - 1]
export const SELECT_TAREFA = 'id, company_id, lead_id, cliente_id, tipo, titulo, data, hora, responsavel_id, responsavel_nome, situacao, resultado, origem'

// wa.me exige só dígitos com DDI. Número brasileiro sem DDI (10–11 dígitos) ganha o 55.
export function whatsappHref(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  return `https://wa.me/${d.length <= 11 ? '55' + d : d}`
}

export const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export function quando(t: Pick<Tarefa, 'data' | 'hora'>): string {
  const [a, m, d] = t.data.split('-')
  return `${d}/${m}${a !== String(new Date().getFullYear()) ? '/' + a : ''}${t.hora ? ' ' + t.hora.slice(0, 5) : ''}`
}
export const atrasada = (t: Pick<Tarefa, 'data' | 'situacao'>) => t.situacao === 'a_fazer' && t.data < hoje()

