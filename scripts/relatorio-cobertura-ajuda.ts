// Relatório de cobertura do "?" (RD-95): telas e campos sem ajuda, por vertical (pasta de dashboard).
//   npx tsx scripts/relatorio-cobertura-ajuda.ts            (resumo por vertical)
//   npx tsx scripts/relatorio-cobertura-ajuda.ts --telas    (lista cada tela com o nº de campos sem "?")
import { arquivosTsx, camposSemAjuda, RAIZES_TELA } from './gates/_ajuda-lib'

const detalhar = process.argv.includes('--telas')
const vertical = (f: string) => f.startsWith('src/app/dashboard/') ? f.split('/')[3] : 'componentes/' + (f.split('/')[2] ?? '')
const por = new Map<string, { telas: number; telasSem: number; campos: number; sem: number }>()
for (const f of RAIZES_TELA.flatMap(arquivosTsx)) {
  const r = camposSemAjuda(f)
  if (!r.length) continue   // só lista tela com campo sem "?"
  const campos = r[0].total
  const v = vertical(f); const o = por.get(v) ?? { telas: 0, telasSem: 0, campos: 0, sem: 0 }
  o.telas++; o.telasSem++; o.campos += campos; o.sem += r.length; por.set(v, o)
  if (detalhar) console.log(`${String(r.length).padStart(4)}  ${f}`)
}
console.log('\nvertical'.padEnd(26) + 'telas sem "?"'.padStart(14) + 'campos sem "?"'.padStart(16))
let t = 0, c = 0
for (const [v, o] of [...por].sort((a, b) => b[1].sem - a[1].sem)) { console.log(v.padEnd(26) + String(o.telasSem).padStart(14) + String(o.sem).padStart(16)); t += o.telasSem; c += o.sem }
console.log('TOTAL'.padEnd(26) + String(t).padStart(14) + String(c).padStart(16))
