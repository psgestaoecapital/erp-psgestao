// Gate (HB0 · correção 8, RD-96, CEO 21/10): as telas do Hub de Projetos usam ícones próprios (lucide) e texto, nunca
// emoji (🎯 📞 🗑️ ✏️ 📷 …) — emoji tem cara de produto genérico e muda de desenho em cada celular. Varre
// src/app/dashboard/projetos e src/components/projetos. Sinais tipográficos (✓ ✕ ⚠ setas ▶ ·) seguem permitidos. Sem rede.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PASTAS = ['src/app/dashboard/projetos', 'src/components/projetos']
const PERMITIDOS = new Set(['✓', '✕', '⚠', '↳', '↩', '↔', '▶', '·', '−', '•', '…'])
const EMOJI = /\p{Extended_Pictographic}/gu

function emojis(src: string): string[] {
  return [...src.matchAll(EMOJI)].map((m) => m[0]).filter((c) => !PERMITIDOS.has(c))
}

function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((n) => {
    const p = join(pasta, n)
    if (statSync(p).isDirectory()) return arquivos(p)
    return /\.(tsx|ts)$/.test(n) ? [p] : []
  })
}

// prova do próprio gate
if (emojis("<span>🎯 meta</span><button>🗑️</button>").length !== 2 || emojis('<div>✓ salvo ✕ ⚠ ↳ · •</div>').length !== 0) {
  console.error('✗ autoteste da regra de emoji do Hub falhou'); process.exit(1)
}

const falhas: string[] = []
let total = 0
for (const pasta of PASTAS) {
  for (const arq of arquivos(pasta)) {
    total++
    readFileSync(arq, 'utf8').split('\n').forEach((linha, i) => {
      const achados = emojis(linha)
      if (achados.length) falhas.push(`${arq}:${i + 1}  ${achados.join(' ')}`)
    })
  }
}
if (falhas.length) {
  console.error(`✗ ${falhas.length} linha(s) com emoji nas telas do Hub (RD-96: use ícone lucide ou texto):`)
  for (const f of falhas) console.error('  ', f)
  process.exit(1)
}
console.log(`✓ ${total} arquivo(s) do Hub sem emoji (RD-96)`)
