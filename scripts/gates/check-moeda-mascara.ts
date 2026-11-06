// #6874 — prova da máscara de dinheiro compartilhada (src/lib/moeda-mascara.ts).
import { moedaMascara, moedaParaNumero, numeroParaMoeda } from '../../src/lib/moeda-mascara'

const norm = (s: string) => s.replace(/ /g, ' ')
let falhas = 0
const eq = (nome: string, got: unknown, want: unknown) => {
  if (got !== want) { falhas++; console.error(`✗ ${nome}: obtido ${JSON.stringify(got)} esperado ${JSON.stringify(want)}`) }
}

eq('mascara 10000000', norm(moedaMascara('10000000')), 'R$ 100.000,00')
eq('mascara vazio', moedaMascara(''), '')
eq('mascara 5', norm(moedaMascara('5')), 'R$ 0,05')
eq('num mascarado', moedaParaNumero(moedaMascara('10000000')), 100000)
eq('num 1234,56', moedaParaNumero('1234,56'), 1234.56)
eq('num 1234.56', moedaParaNumero('1234.56'), 1234.56)
eq('num 1.234,56', moedaParaNumero('1.234,56'), 1234.56)
eq('num vazio', moedaParaNumero(''), null)
eq('num lixo', moedaParaNumero('abc'), null)
eq('numero→moeda', norm(numeroParaMoeda(1234.5)), 'R$ 1.234,50')
eq('numero→moeda null', numeroParaMoeda(null), '')

if (falhas) { console.error(`check-moeda-mascara: ${falhas} falha(s)`); process.exit(1) }
console.log('check-moeda-mascara: ok')
