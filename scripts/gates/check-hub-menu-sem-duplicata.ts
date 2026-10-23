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
const redirect = readFileSync('src/app/dashboard/projetos/acompanhamento/page.tsx', 'utf8')
if (!redirect.includes("redirect('/dashboard/projetos/obras/resultado')")) {
  erros.push('rota antiga /acompanhamento deve seguir redirecionando para obras/resultado')
}
if (erros.length) {
  console.error(erros.join('\n'))
  process.exit(1)
}
console.log('check-hub-menu-sem-duplicata: ok')
