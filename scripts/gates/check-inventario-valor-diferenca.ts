// Gate: o trigger de valor_diferenca do inventário não pode ler NEW.diferenca (GENERATED = NULL em BEFORE).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'supabase/migrations'
const arqs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
let ultima = ''
for (const f of arqs) {
  const s = readFileSync(join(dir, f), 'utf8')
  if (/FUNCTION\s+(public\.)?calc_valor_diferenca\s*\(/i.test(s)) ultima = s
}
if (!ultima) {
  console.error('check-inventario-valor-diferenca: nenhuma migration define calc_valor_diferenca')
  process.exit(1)
}
const corpo = ultima.split(/\$function\$/)[1] ?? ''
if (/NEW\.diferenca/i.test(corpo) || !/quantidade_contada/i.test(corpo)) {
  console.error('check-inventario-valor-diferenca: calc_valor_diferenca deve usar quantidade_contada/quantidade_sistema, não NEW.diferenca')
  process.exit(1)
}
console.log('check-inventario-valor-diferenca: ok')
