// Gate (HB0 · correção 9, CEO 21/10): no celular (390px) nenhuma tabela do Hub pode alargar a tela. Toda <table> das
// telas do Hub (src/app/dashboard/projetos) e dos componentes do Hub (src/components/projetos) fica dentro de um
// contêiner com rolagem horizontal (overflow-x-auto / overflowX: 'auto') aberto nas 4 linhas anteriores. Sem rede.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PASTAS = ['src/app/dashboard/projetos', 'src/components/projetos']
const ROLAGEM = /overflow-x-auto|overflow-auto|overflowX:\s*['"]auto['"]|overflow:\s*['"]auto['"]/

function arquivos(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.tsx') ? [p] : []
  })
}

const sem: string[] = []
let total = 0
for (const f of PASTAS.flatMap(arquivos)) {
  const linhas = readFileSync(f, 'utf8').split('\n')
  linhas.forEach((l, i) => {
    if (!/<table\b/.test(l)) return
    total++
    const antes = linhas.slice(Math.max(0, i - 4), i + 1).join('\n')
    if (!ROLAGEM.test(antes)) sem.push(`${f}:${i + 1}`)
  })
}

// prova do próprio gate: a regra reconhece os dois estilos do Hub (classe e style)
const casoClasse = '<div className="overflow-x-auto">\n<table>'
const casoStyle = "<div style={{ overflowX: 'auto' }}>\n<table>"
const casoNu = '<div>\n<table>'
const autoteste = ROLAGEM.test(casoClasse) && ROLAGEM.test(casoStyle) && !ROLAGEM.test(casoNu)

if (!autoteste) { console.error('✗ autoteste da regra de rolagem falhou'); process.exit(1) }
if (total === 0) { console.error('✗ nenhuma <table> encontrada no Hub (pastas mudaram?)'); process.exit(1) }
if (sem.length) {
  console.error(`✗ ${sem.length} tabela(s) do Hub sem rolagem horizontal (alargam a tela no celular 390px):`)
  for (const s of sem) console.error('  ', s)
  process.exit(1)
}
console.log(`✓ ${total} tabela(s) do Hub com rolagem horizontal no celular`)
