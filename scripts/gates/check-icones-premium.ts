// Gate (CEO 09/10): emoji NÃO é ícone. Tela/componente .tsx novo ou alterado na PR não pode ganhar emoji no texto de
// interface (src/app/dashboard e src/components). Só linhas ADICIONADAS pela PR reprovam — o legado entra no relatório
// (npx tsx scripts/relatorio-icones.ts) e some conforme as telas são tocadas. Use lucide-react (traço fino, identidade PS).
// Compara com o merge-base da origin/main; sem base (checkout raso) → aviso, nunca falha. Sem rede.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { emojisDeInterface, RAIZES_ICONE } from './_icones-lib'

const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 })

function base(): string | null {
  for (const ref of ['origin/main', 'main']) { try { const b = git('merge-base', 'HEAD', ref).trim(); if (b) return b } catch { /* próxima */ } }
  return null
}
const b = base()
if (!b) { console.log('· aviso: sem merge-base com a main — gate de ícones não rodou nesta execução'); process.exit(0) }

const arquivos = git('diff', '--name-only', '--diff-filter=AM', `${b}...HEAD`).split('\n')
  .filter((f) => f.endsWith('.tsx') && RAIZES_ICONE.some((r) => f.startsWith(r + '/')) && existsSync(f))

let falhas = 0
for (const f of arquivos) {
  const add = new Set<number>()
  let atual = 0
  for (const l of git('diff', '-U0', `${b}...HEAD`, '--', f).split('\n')) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (h) { atual = Number(h[1]); const n = h[2] === undefined ? 1 : Number(h[2]); for (let i = 0; i < n; i++) add.add(atual + i); continue }
  }
  for (const a of emojisDeInterface(f)) {
    if (!add.has(a.linha)) continue
    falhas++; console.error(`✗ ${f}:${a.linha} emoji "${a.emoji}" como ícone — use lucide-react (docs/design/rubrica-visual.md)`)
  }
}
console.log(`· ${arquivos.length} tela(s)/componente(s) .tsx novo(s) ou alterado(s) conferido(s)`)
if (falhas) { console.error(`\n${falhas} emoji(s) na interface. Troque por um ícone lucide-react (strokeWidth 1.5).`); process.exit(1) }
console.log('✓ ícones premium: nenhum emoji novo na interface')
