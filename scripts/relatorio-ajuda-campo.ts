// Relatório de cobertura do "?" (RD-95): telas e campos sem ajuda de campo, por vertical (pasta de dashboard).
//   npx tsx scripts/relatorio-ajuda-campo.ts          (resumo por vertical)
//   npx tsx scripts/relatorio-ajuda-campo.ts --telas  (lista tela a tela)
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { camposSemAjuda } from './gates/_ajuda-campo-lib'

const tsx = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? tsx(p) : p.endsWith('.tsx') ? [p.replace(/\\/g, '/')] : []
})
const vertical = (f: string) => {
  const m = f.match(/^src\/app\/dashboard\/([^/]+)/)
  return m ? m[1] : f.startsWith('src/components/') ? `componentes/${f.split('/')[2]}` : 'outros'
}
const arquivos = [...tsx('src/app/dashboard'), ...tsx('src/components')].filter((f) => !f.startsWith('src/components/ajuda/'))
const por = new Map<string, { telas: number; semAjuda: number; campos: number; lista: string[] }>()
for (const f of arquivos) {
  const n = camposSemAjuda(f).length
  if (!n) continue
  const v = vertical(f)
  const r = por.get(v) ?? { telas: 0, semAjuda: 0, campos: 0, lista: [] }
  r.telas++; r.campos += n; r.lista.push(`${f} (${n})`)
  por.set(v, r)
}
const linhas = [...por.entries()].sort((a, b) => b[1].campos - a[1].campos)
console.log('vertical'.padEnd(34), 'telas'.padStart(6), 'campos sem "?"'.padStart(16))
for (const [v, r] of linhas) {
  console.log(v.padEnd(34), String(r.telas).padStart(6), String(r.campos).padStart(16))
  if (process.argv.includes('--telas')) for (const t of r.lista) console.log('   ·', t)
}
console.log('TOTAL'.padEnd(34), String(linhas.reduce((s, [, r]) => s + r.telas, 0)).padStart(6), String(linhas.reduce((s, [, r]) => s + r.campos, 0)).padStart(16))
