/* eslint-disable no-console */
// Sanidade do mapeador F3: títulos sintéticos -> arquivo CNAB válido (240 col, lotes por forma),
// e validação RD-51 (título sem dado sai com motivo; DV ausente bloqueia).
import { mapearRemessaSicoob, buildArquivoSicoob, type TituloPag, type ConfigSicoobDb } from '../src/lib/banco/cnab240'

const cfg: ConfigSicoobDb = {
  cnpj: '60.866.510/0001-78', cooperativa: '3039', agencia_dv: '2', conta: '233117-9', convenio: '1186307',
  razao_social: 'EMPRESA EXEMPLO LTDA', endereco: 'RUA EXEMPLO 100', cidade_estado: 'Cidade Exemplo, SC',
}
const titulos: TituloPag[] = [
  { id: 'a1', forma_pagamento: 'boleto', codigo_barras: '75696124000000077811303901029292300447612001', valor: 77.81, data_vencimento: '2026-08-01', numero_documento: 'DOC1', fornecedor: { cnpj_cpf: '83.829.820/0001-18', nome: 'Fornecedor Um' } },
  { id: 'a2', forma_pagamento: 'boleto', codigo_barras: '85840000004203903852529307162527368217803246', valor: 420.39, data_vencimento: '2026-08-02', numero_documento: 'TRIB1', fornecedor: { cnpj_cpf: null, nome: 'Concessionaria' } }, // começa com 8 -> tributo (seg O)
  { id: 'a3', forma_pagamento: 'pix', valor: 254.60, data_vencimento: '2026-08-03', numero_documento: 'PIX1', fornecedor: { pix: 'exemplo@empresa.com.br', cnpj_cpf: '00.360.305/0001-04', nome: 'Fornecedor Pix' } },
  { id: 'a4', forma_pagamento: 'boleto', codigo_barras: '123', valor: 10, data_vencimento: '2026-08-04', fornecedor: null }, // barcode inválido -> erro
  { id: 'a5', forma_pagamento: 'transferencia', valor: 50, data_vencimento: '2026-08-05', fornecedor: null }, // TED travado -> erro
]
const opts = { dtPagto: '2026-07-28', dataGer: '28072026', horaGer: '101010', seqArq: 7 }

const res = mapearRemessaSicoob(cfg, titulos, opts)
console.log('incluídos:', res.incluidos, '| total:', (res.totalCentavos / 100).toFixed(2))
console.log('erros:', res.erros)
const okInclui = res.incluidos.length === 3
const okErros = res.erros.some((e) => e.motivo.includes('44 dígitos')) && res.erros.some((e) => e.motivo.includes('TED'))
const arq = res.input ? buildArquivoSicoob(res.input) : ''
const linhas = arq.replace(/\r\n/g, '\n').split('\n').filter(Boolean)
const ok240 = linhas.every((l) => l.length === 240)
const temLotes = res.input?.lotes.length === 3 // boleto + tributo + pix

// DV ausente bloqueia
const semDv = mapearRemessaSicoob({ ...cfg, agencia_dv: null }, [titulos[0]], opts)
const okBloqueiaDv = semDv.input === null && semDv.erros.some((e) => e.motivo.includes('DV da agência'))

console.log({ okInclui, okErros, ok240, temLotes, okBloqueiaDv, linhas: linhas.length })
process.exit(okInclui && okErros && ok240 && temLotes && okBloqueiaDv ? 0 : 1)
