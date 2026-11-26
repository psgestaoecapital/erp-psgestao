// Gate (HB0 · correção 10, CEO 21/10): toda tela do Hub tem título. Cada page.tsx de src/app/dashboard/projetos
// renderiza um <h1> próprio, OU usa um componente comum que já o renderiza (InstalarApp), OU é só um redirect de
// servidor (sem tela). Sem rede.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PASTA = 'src/app/dashboard/projetos'
// Componentes compartilhados que já renderizam o próprio <h1> da tela (RD-26 — a page.tsx só os reusa):
// - InstalarApp (tela de instalação do app)
// - AgendaComercialView (Agenda comercial; renderiza <h1>Agenda</h1>, reusada do P&M)
// - MaoObraTela (Mão de obra / Pessoas e custo; renderiza <h1> próprio — #6168, RD-26)
const COMPONENTE_COM_TITULO = /<(InstalarApp|AgendaComercialView|MaoObraTela)\b/

function paginas(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? paginas(p) : n === 'page.tsx' ? [p] : []
  })
}

export function temTitulo(src: string): boolean {
  if (/<h1\b/.test(src) || COMPONENTE_COM_TITULO.test(src)) return true
  // redirect puro: não desenha tela (nenhum JSX)
  return /\bredirect\(/.test(src) && !/<[A-Za-z]/.test(src.replace(/\/\/.*$/gm, ''))
}

// prova do próprio gate
const autoteste =
  temTitulo('return <main><h1>Obras</h1></main>') &&
  temTitulo("return <InstalarApp titulo='x' />") &&
  temTitulo('return <AgendaComercialView eyebrow="Hub · Agenda comercial" />') &&
  temTitulo("import { redirect } from 'next/navigation'\nexport default function P() { redirect('/x') }") &&
  !temTitulo('return <main><h2>Sem título</h2></main>') &&
  !temTitulo("redirect('/x'); return <main>tela</main>")
if (!autoteste) { console.error('✗ autoteste da regra de título falhou'); process.exit(1) }

const todas = paginas(PASTA)
if (todas.length === 0) { console.error('✗ nenhuma page.tsx encontrada no Hub (pasta mudou?)'); process.exit(1) }
const sem = todas.filter((f) => !temTitulo(readFileSync(f, 'utf8')))
if (sem.length) {
  console.error(`✗ ${sem.length} tela(s) do Hub sem título <h1>:`)
  for (const s of sem) console.error('  ', s)
  process.exit(1)
}
console.log(`✓ ${todas.length} tela(s) do Hub com título`)
