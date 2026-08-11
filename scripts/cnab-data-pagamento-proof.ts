/* eslint-disable no-console */
// PROVA (RD-38): a Data do Pagamento do segmento J (pos 145-152) sai da data prevista por título
// (venc → próximo dia útil), NÃO do opts.dtPagto (dia do envio). Bug do retorno 6YT610081821.RET.
import { mapearRemessaSicredi } from '../src/lib/banco/cnab240/mapear-sicredi'
import { buildArquivoSicredi } from '../src/lib/banco/cnab240/sicredi'
import type { TituloPag } from '../src/lib/banco/cnab240/mapear'

const cfg = {
  cnpj: '55081828000103', cooperativa: '0710', agencia_dv: '8', conta: '123456-7',
  convenio: 'CONV123', razao_social: 'KGF AUTOCENTER LTDA', endereco: 'RUA X', cidade_estado: 'SAO MIGUEL DO OESTE, SC',
}
const bc = (suf: string) => ('748' + suf).padEnd(44, '0')  // 44 dígitos, prefixo 748 (Sicredi → lote forma 30)
const titulos: TituloPag[] = [
  { id: 'a1', forma_pagamento: 'boleto', codigo_barras: bc('1'), valor: 100, data_vencimento: '2026-08-11', data_pagamento_prevista: '2026-08-11', fornecedor: { nome: 'FORN A', cnpj_cpf: '11111111000111' } },
  { id: 'a2', forma_pagamento: 'boleto', codigo_barras: bc('2'), valor: 200, data_vencimento: '2026-08-15', data_pagamento_prevista: '2026-08-17', fornecedor: { nome: 'FORN B', cnpj_cpf: '22222222000122' } },
  { id: 'a3', forma_pagamento: 'boleto', codigo_barras: bc('3'), valor: 300, data_vencimento: '2026-08-05', data_pagamento_prevista: '2026-08-11', fornecedor: { nome: 'FORN C', cnpj_cpf: '33333333000133' } },
]
const esperado: Record<string, string> = { a1: '11082026', a2: '17082026', a3: '11082026' }

// opts.dtPagto = 10/08 (o dia do ENVIO — o valor ERRADO do bug). A prova é que a remessa NÃO usa ele.
const opts = { dtPagto: '2026-08-10', dataGer: '10082026', horaGer: '120000', seqArq: 99 }
const res = mapearRemessaSicredi(cfg as never, titulos, opts)
if (!res.input) { console.error('FALHOU: sem input', res.erros); process.exit(1) }
const arquivo = buildArquivoSicredi(res.input as Parameters<typeof buildArquivoSicredi>[0])
const linhas = arquivo.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
const jMain = linhas.filter((l) => l[7] === '3' && l[13] === 'J' && l[14] !== ' ')

let ok = true
console.log('Título | dtVenc(J 91-98) | dtPagto(J 145-152) | esperado | bate?')
jMain.forEach((l, i) => {
  const seuNum = l.slice(182, 202).trim()
  const idKey = ['a1', 'a2', 'a3'][i]
  const dtVenc = l.slice(91, 99)
  const dtPagto = l.slice(144, 152)
  const exp = esperado[idKey]
  const bate = dtPagto === exp
  if (!bate) ok = false
  console.log(`${idKey} (${seuNum.slice(0, 4)}) | ${dtVenc} | ${dtPagto} | ${exp} | ${bate ? 'OK' : 'ERRO'}`)
})
const usouEnvio = jMain.some((l) => l.slice(144, 152) === '10082026')
console.log('\nNenhum J com a data de envio 10082026 (bug)?', usouEnvio ? 'FALHOU — ainda usa envio' : 'OK — usa a prevista')
console.log('RESULTADO:', ok && !usouEnvio ? '✅ PROVA OK' : '❌ PROVA FALHOU')
process.exit(ok && !usouEnvio ? 0 : 1)
