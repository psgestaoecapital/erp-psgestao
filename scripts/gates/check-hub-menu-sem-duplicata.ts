// HB0 item 1: o menu do Hub não pode ter dois itens que abrem a mesma tela
// ("Acompanhamento" redireciona para "Resultado por obra").
import { readFileSync } from 'node:fs'

const layout = readFileSync('src/app/dashboard/projetos/layout.tsx', 'utf8')
const erros: string[] = []
if (/href:\s*"\/dashboard\/projetos\/acompanhamento"/.test(layout)) {
  erros.push('layout do Hub: "Acompanhamento" duplica "Resultado" (mesma tela) — tirar do menu')
}
if (!/href:\s*"\/dashboard\/projetos\/obras\/resultado"/.test(layout)) {
  erros.push('layout do Hub: falta o item "Resultado" (obras/resultado)')
}
// #4130: /acompanhamento deixou de ser redirect e virou TELA PRÓPRIA (andamento das obras/portfólio). A regra anti-
// duplicata passa a ser: ela não pode ser só um desvio/cópia da tela de Resultado (redirect ou reexport dela).
const acompanhamento = readFileSync('src/app/dashboard/projetos/acompanhamento/page.tsx', 'utf8')
if (/redirect\(\s*['"]\/dashboard\/projetos\/obras\/resultado/.test(acompanhamento)
  || /from\s+['"][^'"]*obras\/resultado/.test(acompanhamento)) {
  erros.push('/acompanhamento é tela própria (#4130): não pode redirecionar nem reexportar obras/resultado (duplicata)')
}
if (erros.length) {
  console.error(erros.join('\n'))
  process.exit(1)
}
console.log('check-hub-menu-sem-duplicata: ok')
