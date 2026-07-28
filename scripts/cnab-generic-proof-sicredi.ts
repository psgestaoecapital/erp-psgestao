// PROVA DE GENERICIDADE (CEO): o perfil Sicredi serve para QUALQUER empresa, não só a KGF.
// Usa a MESMA engine/perfil com os dados de OUTRA empresa real (PDOIS / Prigol, cooperativa 0313, posto 01,
// cod_benef 01310) e confirma que o arquivo sai com os dados DELA — sem nenhum vestígio da KGF (6YT6 / 99251).
import { readFileSync } from 'node:fs'
import { buildArquivoSicredi, reconstruirInputSicredi, type ArquivoInputSicredi } from '../src/lib/banco/cnab240/sicredi'

const kgf = reconstruirInputSicredi(readFileSync('docs/cnab/cnab_pgto_748_sicredi_anon.rem', 'latin1'))

// Dados REAIS da PDOIS (Prigol Agência de Publicidade e Propaganda Ltda) — só troca a empresa; os títulos
// (estrutura/itens) são os mesmos, para isolar que a mudança no arquivo vem 100% da config da empresa.
const pdois: ArquivoInputSicredi = {
  ...kgf,
  nomePagador: 'PRIGOL AGENCIA DE PUBLIC LTDA',
  empresa: {
    ...kgf.empresa,
    cnpj: '15585855000107',           // CNPJ da PDOIS
    convenio: 'PD02',                  // cedente da PDOIS (distinto do 6YT6 da KGF)
    agCoop: '0313',                    // cooperativa
    dvAg: '0',
    conta: '01310',                    // cod_benef da PDOIS (KGF era 99251)
    dvCta: '0',
    nome: 'PRIGOL AGENCIA DE PUBLICIDADE E PROP',
  },
}

const arq = buildArquivoSicredi(pdois)
const header = arq.split(/\r\n|\n/)[0]

const cnpj = header.slice(18, 32)
const convenio = header.slice(32, 52).replace(/ +$/, '')
const agencia = header.slice(52, 57)
const conta = header.slice(58, 70)
const nomeEmp = header.slice(72, 102).replace(/ +$/, '')
const nomeBanco = header.slice(102, 132).replace(/ +$/, '')

console.log('HEADER gerado p/ PDOIS:')
console.log('  banco      :', header.slice(0, 3))
console.log('  nomeBanco  :', nomeBanco)
console.log('  CNPJ       :', cnpj)
console.log('  convenio   :', convenio)
console.log('  agencia    :', agencia)
console.log('  conta      :', conta)
console.log('  nomeEmp    :', nomeEmp)

const checks: [string, boolean][] = [
  ['banco = 748 (constante do Sicredi)', header.slice(0, 3) === '748'],
  ['nomeBanco = SICREDI (constante)', nomeBanco === 'SICREDI'],
  ['CNPJ = da PDOIS (15585855000107)', cnpj === '15585855000107'],
  ['convenio = da PDOIS (PD02), NÃO 6YT6 da KGF', convenio === 'PD02'],
  ['conta = cod_benef da PDOIS (000000001310), NÃO 99251 da KGF', conta === '000000001310'],
  ['NÃO contém o convênio 6YT6 da KGF', !arq.includes('6YT6')],
  ['NÃO contém a conta 099251 da KGF', !arq.includes('000000099251')],
  ['arquivo da PDOIS difere do da KGF', arq !== buildArquivoSicredi(kgf)],
]
let ok = 0
console.log('\nchecagens:')
for (const [label, pass] of checks) { console.log(`  ${pass ? '✅' : '❌'} ${label}`); if (pass) ok++ }
console.log(`\n${ok}/${checks.length} — genericidade ${ok === checks.length ? 'PROVADA (sem dado da KGF hardcoded)' : 'FALHOU'}`)
process.exit(ok === checks.length ? 0 : 1)
