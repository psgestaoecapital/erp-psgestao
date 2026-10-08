// Relatório de cobertura do "?" (RD-95): campos sem ajuda por vertical (pasta de src/app/dashboard/<vertical>) e por tela.
//   npx tsx scripts/relatorio-cobertura-ajuda.ts [--json]
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { camposSemAjuda } from '../src/lib/dev/ajudaCampoAnalise'

const arquivos = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.tsx') ? [p.replace(/\\/g, '/')] : []
})
const verticalDe = (f: string) => f.match(/^src\/app\/dashboard\/([^/]+)/)?.[1] ?? f.match(/^src\/components\/([^/]+)/)?.[1] ?? 'outros'

const porVertical = new Map<string, { telas: Map<string, number> }>()
for (const f of [...arquivos('src/app/dashboard'), ...arquivos('src/components')]) {
  const n = camposSemAjuda(f).length
  if (!n) continue
  const v = verticalDe(f)
  if (!porVertical.has(v)) porVertical.set(v, { telas: new Map() })
  porVertical.get(v)!.telas.set(f, n)
}
const linhas = [...porVertical].map(([v, { telas }]) => ({ vertical: v, telas: telas.size, campos: [...telas.values()].reduce((a, b) => a + b, 0), detalhe: Object.fromEntries(telas) }))
  .sort((a, b) => b.campos - a.campos)
if (process.argv.includes('--json')) console.log(JSON.stringify(linhas, null, 2))
else {
  console.log('vertical'.padEnd(28), 'telas'.padStart(6), 'campos sem "?"'.padStart(16))
  for (const l of linhas) console.log(l.vertical.padEnd(28), String(l.telas).padStart(6), String(l.campos).padStart(16))
  console.log('TOTAL'.padEnd(28), String(linhas.reduce((a, l) => a + l.telas, 0)).padStart(6), String(linhas.reduce((a, l) => a + l.campos, 0)).padStart(16))
}
