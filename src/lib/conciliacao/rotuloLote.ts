// #3183 (Jordana · Gean) · lista de extratos da Conciliação: cada linha mostra o PERÍODO movimentado do extrato
// (periodo_inicio–periodo_fim do lote, gravados na importação) para achar o lançamento pela data sem abrir extrato por extrato.

export interface LoteRotulo {
  nome: string | null
  periodo_inicio: string | null
  periodo_fim: string | null
  total_movimentos: number | null
  total_conciliados: number | null
  total_ignorados: number | null
}

/** 'AAAA-MM-DD' (ou ISO com hora) → 'DD/MM/AAAA'; vazio → null */
function dataBR(s: string | null): string | null {
  if (!s) return null
  const [y, m, d] = s.split('T')[0].split('-')
  return y && m && d ? `${d}/${m}/${y}` : null
}

/** período do extrato: "01/09/2026 a 30/09/2026", só um lado quando o outro falta, "16/10/2026" quando é um dia só */
export function periodoLote(l: Pick<LoteRotulo, 'periodo_inicio' | 'periodo_fim'>): string | null {
  const ini = dataBR(l.periodo_inicio)
  const fim = dataBR(l.periodo_fim)
  if (ini && fim) return ini === fim ? ini : `${ini} a ${fim}`
  return ini ?? fim
}

/** texto da linha na lista de extratos: "nome — período — resolvidos/total ok" */
export function rotuloLote(l: LoteRotulo): string {
  const resolvidos = (l.total_conciliados ?? 0) + (l.total_ignorados ?? 0)
  const periodo = periodoLote(l)
  return `${l.nome ?? '(sem nome)'}${periodo ? ` — ${periodo}` : ''} — ${resolvidos}/${l.total_movimentos ?? 0} ok`
}
