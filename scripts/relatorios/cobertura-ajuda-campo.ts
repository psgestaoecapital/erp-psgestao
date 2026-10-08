// Relatório de cobertura do "?" (RD-95): telas e campos sem ajuda de campo, por vertical (primeira pasta depois de
// /dashboard). Serve para orientar a varredura. Só leitura, sem rede.   npm run relatorio:ajuda-campo [-- --json]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { camposSemAjuda } from '../lib/camposSemAjuda'

export const RAIZES_TELA = ['src/app', 'src/components']

export function arquivosTsx(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivosTsx(p) : p.endsWith('.tsx') ? [p.replace(/\\/g, '/')] : []
  })
}

export function vertical(arq: string): string {
  const m = arq.match(/^src\/app\/dashboard\/([^/]+)/)
  if (m) return m[1]
  const c = arq.match(/^src\/components\/([^/]+)\//)
  return c ? `componentes/${c[1]}` : 'outros'
}

if (process.argv[1]?.endsWith('cobertura-ajuda-campo.ts')) {
  const porVertical = new Map<string, { telas: number; campos: number; arquivos: { arq: string; n: number }[] }>()
  let total = 0
  for (const arq of RAIZES_TELA.flatMap(arquivosTsx)) {
    const n = camposSemAjuda(arq, readFileSync(arq, 'utf8')).length
    if (!n) continue
    const v = vertical(arq)
    const e = porVertical.get(v) ?? { telas: 0, campos: 0, arquivos: [] }
    e.telas++; e.campos += n; e.arquivos.push({ arq, n }); total += n
    porVertical.set(v, e)
  }
  const ordenado = [...porVertical.entries()].sort((a, b) => b[1].campos - a[1].campos)
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total_campos_sem_ajuda: total, por_vertical: Object.fromEntries(ordenado) }, null, 2))
  } else {
    console.log(`Cobertura do "?" (RD-95) — ${total} campo(s) sem ajuda em ${ordenado.reduce((s, [, e]) => s + e.telas, 0)} arquivo(s)\n`)
    for (const [v, e] of ordenado) {
      console.log(`${v.padEnd(28)} ${String(e.campos).padStart(5)} campo(s) · ${e.telas} arquivo(s)`)
      for (const a of e.arquivos.sort((x, y) => y.n - x.n).slice(0, 5)) console.log(`    ${String(a.n).padStart(4)}  ${a.arq}`)
    }
  }
}
