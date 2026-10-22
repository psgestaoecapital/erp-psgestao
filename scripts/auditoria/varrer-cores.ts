// Backlog de telas fora da paleta de identidade (CEO 12/10). Uso: npx tsx scripts/auditoria/varrer-cores.ts [pasta]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { auditarCoresFonte } from '../../src/lib/auditores/paletaIdentidade'

const raiz = process.argv[2] ?? 'src/app/dashboard'
const achados: { arq: string; fora: number; deco: number }[] = []
function andar(d: string) {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') andar(p); continue }
    if (!/\.(tsx|css)$/.test(n)) continue
    const v = auditarCoresFonte(readFileSync(p, 'utf8'))
    if (v.length) achados.push({ arq: p, fora: v.filter(x => x.tipo === 'fora_da_paleta').length, deco: v.filter(x => x.tipo === 'semaforo_decorativo').length })
  }
}
andar(raiz)
achados.sort((a, b) => b.fora + b.deco - (a.fora + a.deco))
console.log(`${achados.length} arquivo(s) com cor fora do padrão em ${raiz}`)
for (const a of achados.slice(0, 60)) console.log(`${a.fora + a.deco}\tfora=${a.fora}\tsemaforo_decorativo=${a.deco}\t${a.arq}`)
