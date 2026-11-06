// Gate (HB0 · correção 9, CEO 21/10): no celular (390px) as listas largas do Hub viram CARTÕES em vez de rolar de
// lado. Cada tela abaixo tem um bloco só do celular (`md:hidden` com o data-testid dos cartões) e esconde a tabela no
// celular (`hidden md:block`). Complementa o check-hub-tabelas-celular (rolagem como rede de segurança). Sem rede.
import { readFileSync } from 'node:fs'

const TELAS: { arquivo: string; testid: string }[] = [
  { arquivo: 'src/components/projetos/CatalogoTable.tsx', testid: 'catalogo-cartoes' }, // Catálogo, Insumos, Mão de obra (legado)
  { arquivo: 'src/app/dashboard/projetos/desempenho/page.tsx', testid: 'desempenho-ranking-cartoes' },
  { arquivo: 'src/app/dashboard/projetos/obras/resultado/page.tsx', testid: 'resultado-cartoes' },
]

// regra: bloco do celular com o testid + tabela escondida no celular
function temCartoes(src: string, testid: string): boolean {
  const celular = new RegExp(`className="[^"]*\\bmd:hidden\\b[^"]*"[^>]*data-testid="${testid}"|data-testid="${testid}"[^>]*className="[^"]*\\bmd:hidden\\b`)
  return celular.test(src) && /className="[^"]*\bhidden\b[^"]*\bmd:block\b[^"]*"/.test(src)
}

// prova do próprio gate
const ok = '<div className="space-y-2 md:hidden" data-testid="x"></div><div className="hidden overflow-x-auto md:block"><table>'
const semTabelaEscondida = '<div className="md:hidden" data-testid="x"></div><div className="overflow-x-auto"><table>'
const semCartoes = '<div className="hidden md:block"><table>'
if (!temCartoes(ok, 'x') || temCartoes(semTabelaEscondida, 'x') || temCartoes(semCartoes, 'x')) {
  console.error('✗ autoteste da regra de cartões no celular falhou'); process.exit(1)
}

const falhas = TELAS.filter((t) => !temCartoes(readFileSync(t.arquivo, 'utf8'), t.testid))
if (falhas.length) {
  console.error(`✗ ${falhas.length} tela(s) do Hub sem cartões no celular (a tabela rola de lado em 390px):`)
  for (const f of falhas) console.error('  ', f.arquivo, `(esperado bloco md:hidden data-testid="${f.testid}" + tabela hidden md:block)`)
  process.exit(1)
}
console.log(`✓ ${TELAS.length} lista(s) do Hub viram cartões no celular`)
