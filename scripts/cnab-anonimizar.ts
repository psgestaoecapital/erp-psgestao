/* eslint-disable no-console */
// Anonimiza os fixtures .rem: troca APENAS valores sensíveis (CNPJ, código de barras, chave PIX, nomes,
// endereço, referências de documento) por fictícios do MESMO tamanho, preservando byte a byte toda a
// ESTRUTURA real do banco (constantes, posições, quirks). A prova de layout continua válida; o dado real
// do cliente sai do repositório. Idempotente e determinístico (sem aleatoriedade).
import { readFileSync, writeFileSync } from 'node:fs'
import { parseLine, buildLine, joinArquivo, truncPad } from '../src/lib/banco/cnab240/engine'
import { mapForLine } from '../src/lib/banco/cnab240/sicoob'

const SP = (n: number) => ' '.repeat(n)
// Empresa fictícia (consistente em todas as ocorrências)
const FAKE_EMP_CNPJ = '11222333000181'
const FAKE_EMP_NOME = 'EMPRESA EXEMPLO LTDA'
const FAKE_CONVENIO = '9999'
const FAKE_CONTA = '999999'
const benefMap = new Map<string, string>() // realCNPJ -> fakeCNPJ (consistente)
function fakeBenefCnpj(real: string): string {
  if (!benefMap.has(real)) benefMap.set(real, String(90000000000000 + benefMap.size + 1))
  return benefMap.get(real)!
}
const fakeBarcode = (i: number) => String(i + 1).padStart(44, '7') // 44 dígitos determinístico
function enderecoFake(formaPg: string): string {
  const ind = formaPg === '30' || formaPg === '31' ? SP(2) : '01'
  return SP(40) + truncPad('RUA EXEMPLO', 30) + '00100' + truncPad('SALA 1', 15) +
    truncPad('Cidade Exemplo', 20) + '00000000' + 'SC' + ind + SP(16)
}

for (const fp of ['docs/cnab/cnab_pgto_756_56979.rem', 'docs/cnab/cnab_pgto_756_63082.rem']) {
  const raw = readFileSync(fp, 'latin1')
  const lines = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
  const out: string[] = []
  lines.forEach((line, i) => {
    const map = mapForLine(line)
    const r = parseLine(line, map)
    const tipo = line[7]
    if (tipo === '0') { // header arquivo
      r.cnpj = FAKE_EMP_CNPJ; r.nomeEmp = FAKE_EMP_NOME; r.convenio = FAKE_CONVENIO; r.conta = FAKE_CONTA
    } else if (tipo === '1') { // header lote
      r.cnpj = FAKE_EMP_CNPJ; r.nomeEmp = FAKE_EMP_NOME; r.convenio = FAKE_CONVENIO; r.conta = FAKE_CONTA
      r.resto = enderecoFake(r.formaPg)
    } else if (tipo === '3' && r.seg === 'J' && line[14] !== ' ') { // J principal
      r.codBarras = /^0+$/.test(r.codBarras) ? r.codBarras : fakeBarcode(i) // PIX mantém zerado
      r.nomeBenef = 'BENEFICIARIO EXEMPLO'
      if (r.seuNum.trim()) r.seuNum = 'DOC' + String(i + 1).padStart(7, '0')
    } else if (tipo === '3' && r.seg === 'J') { // J-52
      r.cnpjPag = FAKE_EMP_CNPJ; r.nomePag = FAKE_EMP_NOME
      r.cnpjBenef = fakeBenefCnpj(r.cnpjBenef); r.nomeBenef = 'BENEFICIARIO EXEMPLO LTDA'
      if (!r.resto.startsWith('0000000000000000')) r.resto = truncPad('pix-exemplo-ficticio-' + String(i + 1).padStart(8, '0'), 109)
    } else if (tipo === '3' && r.seg === 'O') { // tributo (nomeConc é órgão público, mantém)
      r.codBarras = fakeBarcode(i)
      r.resto = truncPad(String(i + 1).padStart(10, '0'), 118) // controle fictício
    }
    out.push(buildLine(r, map))
  })
  writeFileSync(fp, joinArquivo(out), 'latin1')
  console.log(`anonimizado: ${fp} (${out.length} linhas)`)
}
