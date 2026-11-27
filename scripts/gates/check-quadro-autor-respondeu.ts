// Gate (#7050 fatia2 step 4 · jordana-code) — o destaque "✉️ Autor respondeu" no QUADRO (Kanban) da fila.
// A Lista já mostrava o aviso (#6930); faltava no Quadro. Prova estática (sem rede/banco):
//  1. QuadroChamados aceita autorRespondeu e só acende o selo na coluna "Em andamento" no modo operador;
//  2. a página de atendimento passa o sinal (autorAguarda) para o Quadro.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); falhas++ } }

const quadro = readFileSync('src/components/melhorias/QuadroChamados.tsx', 'utf8')
ok(/autorRespondeu\?:\s*Set<string>/.test(quadro), 'QuadroChamados: prop autorRespondeu?: Set<string>')
ok(/autorRespondeu=\{modo === 'operador' && col === 'andamento' && !!autorRespondeu\?\.has\(c\.id\)\}/.test(quadro),
  'selo só na coluna "andamento" do operador e só quando o autor respondeu')
ok(/data-testid=\{`kanban-autor-respondeu-\$\{c\.numero\}`\}/.test(quadro), 'selo "✉️ Autor respondeu" renderizado no cartão')

const page = readFileSync('src/app/dashboard/atendimento/page.tsx', 'utf8')
ok(/<QuadroChamados[\s\S]*?autorRespondeu=\{autorAguarda\}[\s\S]*?\/>/.test(page),
  'atendimento passa autorRespondeu={autorAguarda} ao Quadro')

if (falhas) { console.error(`check-quadro-autor-respondeu: ${falhas} falha(s)`); process.exit(1) }
console.log('check-quadro-autor-respondeu: ok')
