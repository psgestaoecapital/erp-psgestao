// PROVA do parser de RETORNO Sicredi (RD-38). Sem arquivo de retorno real ainda; provamos contra:
//  (A) o fixture anonimizado da REMESSA (docs/cnab/cnab_pgto_748_sicredi_anon.rem) — que tem data e valor
//      preenchidos nos J000, então o parser deve extrair cada J000 com codBarras 44 díg, valor > 0 e pagoHint.
//  (B) linhas SINTÉTICAS derivadas do fixture: uma "rejeitada" (data zerada + valor 0 → pagoHint=false) e uma
//      com ocorrência conhecida em [231-240] (confere a extração da ocorrência).
// Quando a Jordana tiver o 1º retorno REAL, colocar em .cnab-real/sicredi_retorno_real.rem: o parser roda
// contra ele e validamos posições/ocorrências de verdade antes de confiar na baixa automática.
import { readFileSync, existsSync } from 'node:fs'
import { parseRetornoSicredi } from '../src/lib/banco/cnab240/retorno-sicredi'

const REAL = '.cnab-real/sicredi_retorno_real.rem'
const ANON = 'docs/cnab/cnab_pgto_748_sicredi_anon.rem'
const fp = existsSync(REAL) ? REAL : ANON
const contraReal = fp === REAL
const raw = readFileSync(fp, 'latin1')
console.log(`Gabarito: ${fp}${contraReal ? ' (RETORNO REAL)' : ' (fixture da remessa — prova estrutura + valores preenchidos)'}`)

const r = parseRetornoSicredi(raw)
const linhas = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
const j000 = linhas.filter((l) => l[7] === '3' && l[13] === 'J' && l[14] !== ' ').length

let falhas = 0
const check = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('  ❌ ' + msg) } else console.log('  ✓ ' + msg) }

console.log(`\n(A) Estrutura — NSA=${r.nsa}, J000 no arquivo=${j000}, itens parseados=${r.itens.length}`)
check(r.itens.length === j000, `parseou todos os J000 (${r.itens.length}/${j000})`)
check(r.nsa > 0, `NSA lido do header (${r.nsa})`)
check(r.itens.every((i) => i.codBarras.length === 44), 'todo item com código de barras de 44 dígitos')
check(r.itens.every((i) => i.valTitulo > 0), 'todo item com valor de título > 0')
if (!contraReal) {
  // No fixture da remessa, data/valor de pagamento vieram preenchidos → pagoHint verdadeiro em todos.
  check(r.itens.every((i) => i.valPago > 0 && i.dtPagamento !== null && i.pagoHint), 'todo item com pagoHint (data + valor pago)')
}

// (B) Sintéticos derivados de um J000 real do arquivo.
const baseJ000 = linhas.find((l) => l[7] === '3' && l[13] === 'J' && l[14] !== ' ')!
const setAt = (s: string, start0: number, val: string) => s.slice(0, start0) + val + s.slice(start0 + val.length)

// (B1) rejeitado: zera data [145-152] e valor pago [153-167].
const rej = setAt(setAt(baseJ000, 144, '00000000'), 152, '0'.repeat(15))
const pr = parseRetornoSicredi(rej)
console.log('\n(B1) Linha rejeitada (data/valor zerados)')
check(pr.itens.length === 1 && pr.itens[0].pagoHint === false, 'pagoHint=false quando não há data+valor')

// (B2) ocorrência conhecida em [231-240].
const occ = setAt(baseJ000, 230, 'BD'.padEnd(10, ' '))
const po = parseRetornoSicredi(occ)
console.log('\n(B2) Ocorrência em [231-240] = "BD"')
check(po.itens.length === 1 && po.itens[0].ocorrencias.startsWith('BD'), `ocorrência extraída ("${po.itens[0]?.ocorrencias}")`)

console.log(falhas === 0
  ? `\n✅ Parser de retorno Sicredi OK (${contraReal ? 'ARQUIVO REAL' : 'estrutura + sintéticos'}). Casamento é por código de barras; baixa só com valor conferido (RD-38).`
  : `\n❌ ${falhas} verificação(ões) falharam — revisar antes de usar.`)
process.exit(falhas === 0 ? 0 : 1)
