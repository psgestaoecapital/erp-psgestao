// P&M · apontamento de horas em 1 toque (onda 2 da P&M da Pdois, mapeamento do SIGA, Parte S, atrito 18: "apontar hora em
// 1 toque"). Regra pura, sem rede: os atalhos de tempo e o job que vem no link (?job=) dos avisos "Lançar horas"/"apontar".
export const ATALHOS_HORAS: { horas: number; rotulo: string }[] = [
  { horas: 0.25, rotulo: '+15 min' },
  { horas: 0.5, rotulo: '+30 min' },
  { horas: 1, rotulo: '+1 h' },
  { horas: 2, rotulo: '+2 h' },
]

// Job pedido no link, só se for um job da empresa carregada (link velho ou de outra empresa → nada selecionado).
export function jobDoLink(busca: string, jobs: { id: string }[]): string {
  const id = new URLSearchParams(busca).get('job')?.trim() ?? ''
  return id && jobs.some((j) => j.id === id) ? id : ''
}
