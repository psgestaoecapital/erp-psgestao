// Gate #5440 / #5427: lista de OS carrega todas (não corta em 200) e "Faturada - ver na GE" abre as receitas filtradas pela OS.
// Sem rede, sem banco.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const lista = readFileSync('src/app/dashboard/os/page.tsx', 'utf8')
ok(!/p_limit:\s*200\b/.test(lista), 'lista de OS não corta em 200')
ok(/p_limit:\s*5000\b/.test(lista), 'lista de OS carrega até 5000 por empresa')

const card = readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8')
ok(/financeiro\/receber\?busca=\$\{encodeURIComponent\(os\.numero\)\}/.test(card), '"ver na GE" leva o número da OS na busca')

const view = readFileSync('src/components/financeiro/ListagemPagarReceberView.tsx', 'utf8')
ok(/qs\.get\('busca'\)/.test(view) && /setBusca\(buscaUrl\)/.test(view), 'receber lê ?busca= e preenche o campo de busca')

if (falhas) process.exit(1)
