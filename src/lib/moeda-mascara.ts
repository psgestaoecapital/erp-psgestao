// #6874 — máscara de dinheiro (R$) compartilhada: mostra "R$ 100.000,00" enquanto digita e
// devolve o número. Pura (sem React), testável, usada por <CampoMoeda />.
export function moedaMascara(s: string): string {
  const d = String(s ?? '').replace(/\D/g, '')
  if (!d) return ''
  return (Number(d) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** "R$ 1.234,56" → 1234.56; vazio/ilegível → null. Também aceita "1234.56" e "1234,56". */
export function moedaParaNumero(s: string): number | null {
  const t = String(s ?? '').trim()
  if (!t) return null
  const limpo = /[R$]/.test(t) || (t.includes('.') && t.includes(','))
    ? t.replace(/[R$\s.]/g, '').replace(',', '.')
    : t.replace(/\s/g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

/** Número → texto mascarado para preencher o campo (edição de valor já gravado). */
export function numeroParaMoeda(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
