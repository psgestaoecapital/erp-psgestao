// Relatório (CEO 09/10): telas/componentes com emoji na interface, por vertical — insumo da varredura de ícones premium.
//   npx tsx scripts/relatorio-icones.ts           (resumo por vertical)
//   npx tsx scripts/relatorio-icones.ts --telas   (lista cada arquivo com a contagem)
import { arquivosTsx, emojisDeInterface, RAIZES_ICONE } from './gates/_icones-lib'

const detalhar = process.argv.includes('--telas')
const vertical = (f: string) => f.startsWith('src/app/dashboard/') ? f.split('/')[3] : 'componentes/' + (f.split('/')[2] ?? '')
const por = new Map<string, { arquivos: number; emojis: number }>()
for (const f of RAIZES_ICONE.flatMap(arquivosTsx)) {
  const r = emojisDeInterface(f)
  if (!r.length) continue
  const v = vertical(f); const o = por.get(v) ?? { arquivos: 0, emojis: 0 }
  o.arquivos++; o.emojis += r.length; por.set(v, o)
  if (detalhar) console.log(`${String(r.length).padStart(4)}  ${f}  ${[...new Set(r.map((x) => x.emoji))].join(' ')}`)
}
console.log('\nvertical'.padEnd(26) + 'arquivos'.padStart(10) + 'emojis'.padStart(10))
let a = 0, e = 0
for (const [v, o] of [...por].sort((x, y) => y[1].emojis - x[1].emojis)) { console.log(v.padEnd(26) + String(o.arquivos).padStart(10) + String(o.emojis).padStart(10)); a += o.arquivos; e += o.emojis }
console.log('TOTAL'.padEnd(26) + String(a).padStart(10) + String(e).padStart(10))
