// Oportunidades — alerta de DUPLICATA e VALOR-OUTLIER (auditor FC 27/10). Puro, sem rede: recebe os dados prontos.
// Não bloqueia nada: só chama atenção para revisar antes de seguir (caso Tryo R$ 3,5 mi com mediana R$ 40 mil).
// Testado por scripts/gates/check-oportunidade-alerta.ts (RD-38).

// Fator do outlier: valor acima de N× a mediana das abertas é "fora do padrão" (provável erro de digitação).
// 10 = uma ordem de grandeza — forte o bastante para não acusar um negócio só 2–3× maior que o normal.
export const FATOR_OUTLIER = 10
// Mínimo de amostras (valores > 0) para a mediana ser estável — com poucas abertas não acusamos outlier.
export const MIN_AMOSTRAS_OUTLIER = 4

const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')

export function mediana(valores: number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
  if (v.length === 0) return null
  const meio = Math.floor(v.length / 2)
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2
}

export type OportMin = { id: string; cliente: string | null; titulo: string | null; valor_estimado: number | null }
export type FlagCard = { duplicata: boolean; outlier: boolean }

// Flags por card, a partir das oportunidades ABERTAS (as colunas operacionais do kanban já excluem ganho/perdido).
// duplicata: outro card com o MESMO cliente e o MESMO título (sem diferenciar acento/caixa).
// outlier: valor acima de FATOR_OUTLIER × a mediana das abertas (com amostras suficientes).
export function flagsPorCard(cards: OportMin[], fator = FATOR_OUTLIER): Record<string, FlagCard> {
  const med = mediana(cards.map((c) => Number(c.valor_estimado ?? 0)))
  const amostras = cards.filter((c) => Number(c.valor_estimado ?? 0) > 0).length
  const limite = med != null && amostras >= MIN_AMOSTRAS_OUTLIER ? med * fator : null
  // agrupa por cliente+título para achar repetidos
  const chave = (c: OportMin) => `${norm(c.cliente)}|${norm(c.titulo)}`
  const conta = new Map<string, number>()
  for (const c of cards) { const k = chave(c); if (norm(c.cliente) || norm(c.titulo)) conta.set(k, (conta.get(k) ?? 0) + 1) }
  const out: Record<string, FlagCard> = {}
  for (const c of cards) {
    const duplicata = (conta.get(chave(c)) ?? 0) > 1
    const outlier = limite != null && Number(c.valor_estimado ?? 0) > limite
    if (duplicata || outlier) out[c.id] = { duplicata, outlier }
  }
  return out
}

// Aviso do formulário ao salvar/editar: compara o candidato com as oportunidades abertas (excluindo ele mesmo).
// Devolve a frase curta (ou null). Não bloqueia — a tela só mostra o aviso.
export function avisoOportunidade(
  candidato: { id?: string | null; clienteId: string | null; titulo: string | null; valor: number | null },
  abertas: { id: string; cliente_id: string | null; titulo: string | null; valor_estimado: number | null }[],
  fator = FATOR_OUTLIER,
): string | null {
  const outras = abertas.filter((o) => o.id !== candidato.id)
  const avisos: string[] = []
  if (candidato.clienteId) {
    const tituloCand = norm(candidato.titulo)
    const dup = outras.find((o) =>
      o.cliente_id === candidato.clienteId &&
      ((tituloCand && norm(o.titulo) === tituloCand) ||
       (candidato.valor != null && Number(o.valor_estimado ?? NaN) === candidato.valor)))
    if (dup) avisos.push('possível duplicata: já existe uma oportunidade aberta deste cliente com o mesmo título ou valor')
  }
  const med = mediana(outras.map((o) => Number(o.valor_estimado ?? 0)))
  const amostras = outras.filter((o) => Number(o.valor_estimado ?? 0) > 0).length
  if (candidato.valor != null && med != null && amostras >= MIN_AMOSTRAS_OUTLIER && candidato.valor > med * fator) {
    avisos.push(`valor fora do padrão: ${fmtBRL(candidato.valor)} é mais de ${fator}× a mediana das abertas (${fmtBRL(med)}) — confira se não há erro de digitação`)
  }
  return avisos.length ? avisos.join(' · ') : null
}

const fmtBRL = (v: number) => {
  if (!Number.isFinite(v)) return 'R$ 0,00'
  const [int, dec] = Math.abs(v).toFixed(2).split('.')
  return `${v < 0 ? '-' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}
