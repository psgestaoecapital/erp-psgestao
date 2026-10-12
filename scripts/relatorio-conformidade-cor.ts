// Backlog de conformidade de cor (paleta de identidade PS): telas com cor fora da paleta ou semáforo decorativo.
//   npx tsx scripts/relatorio-conformidade-cor.ts [--telas]
import { arquivosTsx, RAIZES_TELA } from './gates/_ajuda-lib'
import { readFileSync } from 'node:fs'
import { violacoesDeCor } from '../src/lib/auditores/paletaIdentidade'

const detalhar = process.argv.includes('--telas')
let total = 0, telas = 0
const linhas: [number, string][] = []
for (const f of RAIZES_TELA.flatMap(arquivosTsx)) {
  const v = violacoesDeCor(readFileSync(f, 'utf8'))
  if (!v.length) continue
  telas++; total += v.length; linhas.push([v.length, f])
}
for (const [n, f] of detalhar ? linhas.sort((a, b) => b[0] - a[0]) : linhas.sort((a, b) => b[0] - a[0]).slice(0, 25)) console.log(String(n).padStart(5) + '  ' + f)
console.log(`\nTelas fora do padrão de cor: ${telas} · violações: ${total}`)
