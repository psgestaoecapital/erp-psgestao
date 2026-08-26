// Fonte única (RD-52) dos parsers numéricos/data no formato BR, reusados na importação
// de pesagem (FIX-PESAGEM-VÍRGULA #1146) e na migração financeira (IMPORT-FINANCEIRO).

// Converte número respeitando formato BR e US ANTES de parsear.
// O ponto só é tratado como milhar quando há vírgula decimal depois dele — assim
// "432.9" (número vindo do xlsx com raw:false) NÃO vira 4329.
// Casos: "432,9"→432.9 | "1.234,5"→1234.5 | "500"→500 | "398.0"→398 | "1,234.5"→1234.5
export function parseNumBR(s: string | number | null | undefined): number | null {
  if (s == null) return null
  let t = String(s).trim()
  if (t === '') return null
  if (t.includes(',') && t.includes('.')) {
    // vírgula depois do ponto ⇒ BR (ponto = milhar, vírgula = decimal); senão US (vírgula = milhar)
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.')
    else t = t.replace(/,/g, '')
  } else if (t.includes(',')) {
    t = t.replace(',', '.') // só vírgula ⇒ decimal BR
  }
  t = t.replace(/[^\d.\-]/g, '') // remove unidades/espaços; separadores já normalizados
  if (!/\d/.test(t)) return null // sem dígito (ex.: "abc") ⇒ não é número
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// Aceita YYYY-MM-DD ou DD/MM/YYYY → normaliza p/ YYYY-MM-DD (ISO); null se inválida.
export function parseDataBR(s: string | number | null | undefined): string | null {
  const t = String(s ?? '').trim()
  if (!t) return null
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}
