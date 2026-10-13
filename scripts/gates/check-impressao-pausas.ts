/**
 * Gate de build (#258 · Frioeste SST): o documento de pausas para assinatura imprimia a 1ª folha duas vezes e sem o
 * bloco de assinatura (impresso de dentro de um modal fixo, com altura máxima e rolagem). Confere as regras de impressão
 * e que os dois documentos imprimíveis da tela saem por portal.
 *   tsx scripts/check-impressao-pausas.ts
 */
import { readFileSync } from 'node:fs'
import { CSS_IMPRESSAO } from '../../src/lib/ponto/impressaoDocumento'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const css = CSS_IMPRESSAO.replace(/\s+/g, ' ')

ok(/body > \*:not\(\.ps-print-portal\) \{ display: none !important/.test(css), 'na impressão, só o documento aparece (o resto da página some)')
ok(/\.ps-print-portal \{[^}]*position: static !important/.test(css), 'o fundo do modal deixa de ser fixo (fixo repete em toda folha)')
ok(/\.ps-print-doc \{[^}]*max-height: none !important/.test(css) && /\.ps-print-doc \{[^}]*overflow: visible !important/.test(css), 'o cartão perde altura máxima e rolagem (nada é cortado)')
ok(/\.ps-print-assinatura \{[^}]*break-inside: avoid/.test(css), 'o bloco de assinatura não se parte entre folhas')

const pagina = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
for (const nome of ['ModalCienciaDoc', 'ModalProva']) {
  const ini = pagina.indexOf(`function ${nome}(`)
  const corpo = pagina.slice(ini, pagina.indexOf('\nfunction ', ini + 10))
  ok(ini > 0 && corpo.includes('createPortal(') && corpo.includes('document.body') && corpo.includes('ps-print-portal') && corpo.includes('ps-print-doc'),
    `${nome}: sai por portal no <body> com as classes de impressão`)
}
ok(pagina.includes('className="ps-print-assinatura"'), 'o bloco de assinatura do documento de ciência está marcado')

if (falhas) { console.error(`\n[check-impressao-pausas] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-impressao-pausas] impressão do documento de pausas conferida.')
