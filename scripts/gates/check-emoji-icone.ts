// Gate (CEO 09/10, rubrica visual premium): emoji NÃO é ícone. Telas e componentes usam o conjunto único de traço fino
// (lucide-react, via src/components/ui/Icone.tsx). Baseline por arquivo em scripts/gates/emoji-icone-baseline.json: arquivo
// novo nasce sem emoji; arquivo existente não pode ter MAIS linhas com emoji que o baseline (só diminui). Sem rede.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZES = ['src/app/dashboard', 'src/components']
const EMOJI = /\p{Extended_Pictographic}/u
const base: Record<string, number> = JSON.parse(readFileSync('scripts/gates/emoji-icone-baseline.json', 'utf8'))

function arquivos(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.tsx') ? [p] : []
  })
}

let falhas = 0
for (const raiz of RAIZES) {
  for (const p of arquivos(raiz)) {
    const n = readFileSync(p, 'utf8').split('\n').filter((l) => EMOJI.test(l)).length
    const permitido = base[p] ?? 0
    if (n > permitido) { falhas++; console.error(`✗ ${p}: ${n} linha(s) com emoji (baseline ${permitido}). Use o ícone de traço fino (Icone.tsx).`) }
  }
}
if (falhas) { console.error(`${falhas} arquivo(s) com emoji acima do baseline`); process.exit(1) }
console.log('check-emoji-icone: OK')
