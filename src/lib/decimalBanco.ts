// #102: número digitado em formato BR ("1,5" · "1.234,5") → texto que o banco entende ("1.5" · "1234.5"). Vazio = vazio.
export const decimalBanco = (q?: string | null): string => {
  const t = String(q ?? '').trim()
  if (!t) return ''
  return t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
}
