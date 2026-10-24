// HB0 (auditor F15 em /dashboard/projetos/propostas) — números do funil de propostas, numa regra só e sem rede.
// A tela e o gate usam estas funções: o contador é honesto (conta o que está na lista, sem estimar).

export type PropostaFunil = { status: string; total: number | null; data_validade: string | null }

export const ABERTAS = ['rascunho', 'enviado', 'visualizado'] as const
export const GANHAS = ['aprovado', 'convertido'] as const
export const PERDIDAS = ['recusado', 'expirado'] as const

const em = (lista: readonly string[], s: string) => lista.includes(s)
const soma = (ls: PropostaFunil[]) => ls.reduce((s, l) => s + Number(l.total ?? 0), 0)

// Dias entre hoje e a validade (data ISO AAAA-MM-DD). Negativo = já venceu. Sem validade → null.
export function diasParaVencer(validade: string | null, hoje: Date = new Date()): number | null {
  if (!validade || !/^\d{4}-\d{2}-\d{2}/.test(validade)) return null
  const [a, m, d] = validade.slice(0, 10).split('-').map(Number)
  const alvo = Date.UTC(a, m - 1, d)
  const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  return Math.round((alvo - base) / 86400000)
}

export function resumoFunil(ls: PropostaFunil[], hoje: Date = new Date()) {
  const abertas = ls.filter(l => em(ABERTAS, l.status))
  const ganhas = ls.filter(l => em(GANHAS, l.status))
  const perdidas = ls.filter(l => em(PERDIDAS, l.status))
  const decididas = ganhas.length + perdidas.length
  const aVencer = abertas.filter(l => { const d = diasParaVencer(l.data_validade, hoje); return d !== null && d >= 0 && d <= 7 })
  const porStatus: Record<string, { n: number; valor: number }> = {}
  for (const l of ls) {
    const s = (porStatus[l.status] ??= { n: 0, valor: 0 })
    s.n++; s.valor += Number(l.total ?? 0)
  }
  return {
    total: ls.length,
    abertas: abertas.length, valorAberto: soma(abertas),
    ganhas: ganhas.length, valorGanho: soma(ganhas),
    // Taxa só sobre o que o cliente já decidiu; sem decisão nenhuma, não há taxa (null, a tela mostra "—").
    taxaAprovacao: decididas ? Math.round((ganhas.length / decididas) * 100) : null,
    aVencer: aVencer.length, valorAVencer: soma(aVencer),
    porStatus,
  }
}
