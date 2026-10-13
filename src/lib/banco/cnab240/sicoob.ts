// PERFIL SICOOB (banco 756) para o motor CNAB 240 de PAGAMENTO.
// Mapas de campo + constantes de layout MEDIDOS dos 2 arquivos .rem reais (docs/cnab/). Versão 087/040.
// O gerador computa estrutura (nSeq, lotes, trailers). Provado byte a byte em scripts/cnab-gen-proof.ts.
// 🔴 DINHEIRO SAINDO: TED (segmento A) fica em ./segmento-a.ts, TRAVADO p/ homologação (sem .rem real).
import { Field, buildLine, joinArquivo, truncPad } from './engine'

// ---------------- MAPAS DE CAMPO (posição a posição, medidos do real) ----------------
export const HEADER_ARQ: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['cnab1', 9, 'R'], ['tpInsc', 1, 'N'], ['cnpj', 14, 'N'],
  ['convenio', 20, 'N'], ['agCoop', 5, 'N'], ['dvAg', 1, 'A'], ['conta', 12, 'N'], ['dvCta', 1, 'A'], ['dvAgCta', 1, 'R'],
  ['nomeEmp', 30, 'A'], ['nomeBanco', 30, 'A'], ['cnab2', 10, 'R'], ['codRemessa', 1, 'N'], ['dataGer', 8, 'N'],
  ['horaGer', 6, 'N'], ['seqArq', 6, 'N'], ['versaoArq', 3, 'N'], ['densidade', 5, 'N'], ['resto', 69, 'R'],
]
export const HEADER_LOTE: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['tpOper', 1, 'A'], ['tpServ', 2, 'N'], ['formaPg', 2, 'N'],
  ['versaoLote', 3, 'N'], ['cnab1', 1, 'R'], ['tpInsc', 1, 'N'], ['cnpj', 14, 'N'], ['convenio', 20, 'N'], ['agCoop', 5, 'N'],
  ['dvAg', 1, 'A'], ['conta', 12, 'N'], ['dvCta', 1, 'A'], ['dvAgCta', 1, 'R'], ['nomeEmp', 30, 'A'], ['resto', 138, 'R'],
]
export const SEG_J: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['nSeq', 5, 'N'], ['seg', 1, 'A'], ['mov', 3, 'N'],
  ['codBarras', 44, 'A'], ['nomeBenef', 30, 'A'], ['dtVenc', 8, 'N'], ['valTitulo', 15, 'N'], ['desconto', 15, 'N'],
  ['acrescimo', 15, 'N'], ['dtPagto', 8, 'N'], ['valPagto', 15, 'N'], ['qtdMoeda', 15, 'N'], ['seuNum', 20, 'A'], ['resto', 38, 'R'],
]
export const SEG_J52: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['nSeq', 5, 'N'], ['seg', 1, 'A'], ['pref', 6, 'R'],
  ['tpInscPag', 1, 'R'], ['cnpjPag', 14, 'N'], ['nomePag', 40, 'A'], ['sepBenef', 1, 'R'], ['tpInscBenef', 1, 'R'],
  ['cnpjBenef', 14, 'N'], ['nomeBenef', 40, 'A'], ['resto', 109, 'R'],
]
export const SEG_O: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['nSeq', 5, 'N'], ['seg', 1, 'A'], ['mov', 3, 'N'],
  ['codBarras', 44, 'A'], ['nomeConc', 30, 'A'], ['dtVenc', 8, 'N'], ['dtPagto', 8, 'N'], ['valPagto', 15, 'N'], ['resto', 118, 'R'],
]
export const TRAILER_LOTE: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['cnab1', 9, 'R'], ['qtdReg', 6, 'N'], ['somaVal', 18, 'N'], ['resto', 199, 'R'],
]
export const TRAILER_ARQ: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['cnab1', 9, 'R'], ['qtdLotes', 6, 'N'], ['qtdReg', 6, 'N'], ['resto', 211, 'R'],
]

/** Seleciona o mapa da linha (usado pela leitura/round-trip). */
export function mapForLine(line: string): Field[] {
  const tipo = line[7]
  if (tipo === '0') return HEADER_ARQ
  if (tipo === '1') return HEADER_LOTE
  if (tipo === '5') return TRAILER_LOTE
  if (tipo === '9') return TRAILER_ARQ
  const seg = line[13]
  if (seg === 'O') return SEG_O
  if (seg === 'J') return line[14] === ' ' ? SEG_J52 : SEG_J
  throw new Error('registro CNAB desconhecido: tipo=' + tipo + ' seg=' + seg)
}

// ---------------- CONSTANTES DE LAYOUT (medidas do real) ----------------
const SP = (n: number) => ' '.repeat(n)
const BANCO = '756'
const J_RESTO = SP(20) + '09' + SP(16)              // [203-240] constante em todo segmento J
const J52_BOLETO_TAIL = '0000000000000000' + SP(93) // [132-240] no boleto (16 zeros + brancos)
const TRAILER_LOTE_RESTO = '0'.repeat(24) + SP(175)  // [42-240]
const TRAILER_ARQ_RESTO = '000000' + SP(205)         // [30-240]

// ---------------- TIPOS DE ENTRADA (semânticos — o que o mapeador de erp_pagar preenche) ----------------
export type EmpresaSicoob = {
  cnpj: string; convenio: string; agCoop: string; dvAg: string; conta: string; dvCta: string; nome: string
  logradouro: string; numero: string; complemento: string; cidade: string; cep: string; uf: string
}
export type ItemJ = {
  seg: 'J'; codBarras: string; nomeBenef: string; dtVenc: string; valTitulo: number; valPagto: number
  desconto?: number; acrescimo?: number; qtdMoeda?: number; dtPagto: string; seuNum: string
  cnpjBenef: string; nomeBenefFull: string; pixKey?: string
}
export type ItemO = { seg: 'O'; codBarras: string; nomeConc: string; dtVenc: string; dtPagto: string; valPagto: number; controle: string }
export type LoteInput = { tpServ: string; formaPg: string; itens: (ItemJ | ItemO)[] }
export type ArquivoInput = { empresa: EmpresaSicoob; dataGer: string; horaGer: string; seqArq: number; lotes: LoteInput[] }

const cents = (n: number) => String(Math.round(n)) // valor já em centavos (inteiro)

function enderecoBloco(e: EmpresaSicoob, formaPg: string): string {
  const ind = formaPg === '30' || formaPg === '31' ? SP(2) : '01' // boleto: brancos; tributo/PIX: '01'
  return (
    SP(40) + truncPad(e.logradouro, 30) + String(e.numero).replace(/\D/g, '').padStart(5, '0') +
    truncPad(e.complemento, 15) + truncPad(e.cidade, 20) + String(e.cep).replace(/\D/g, '').padStart(8, '0') +
    truncPad(e.uf, 2) + ind + SP(16)
  )
}

/**
 * Gera o arquivo de remessa CNAB 240 do Sicoob a partir de dados semânticos.
 * Computa numeração de registros, lotes por forma, e trailers (contagem/somatória).
 * 🔴 Boleto (J), Tributo (O) e PIX (J/47) provados byte a byte. Não inclui TED (segmento A).
 */
export function buildArquivoSicoob(inp: ArquivoInput): string {
  const e = inp.empresa
  const emp = {
    banco: BANCO, tpInsc: '2', cnpj: e.cnpj, convenio: e.convenio, agCoop: e.agCoop, dvAg: e.dvAg,
    conta: e.conta, dvCta: e.dvCta, dvAgCta: ' ', nomeEmp: e.nome,
  }
  const linhas: string[] = []

  linhas.push(buildLine({
    ...emp, lote: '0', tipo: '0', cnab1: SP(9), cnab2: SP(10), nomeBanco: 'SiCoob',
    codRemessa: '1', dataGer: inp.dataGer, horaGer: inp.horaGer, seqArq: String(inp.seqArq),
    versaoArq: '087', densidade: '01600', resto: SP(69),
  }, HEADER_ARQ))

  inp.lotes.forEach((lote, li) => {
    const loteNum = String(li + 1).padStart(4, '0')
    linhas.push(buildLine({
      ...emp, lote: loteNum, tipo: '1', tpOper: 'C', tpServ: lote.tpServ, formaPg: lote.formaPg,
      versaoLote: lote.tpServ === '22' ? '012' : '040', cnab1: ' ', resto: enderecoBloco(e, lote.formaPg),
    }, HEADER_LOTE))

    let nseq = 0
    let soma = 0
    for (const it of lote.itens) {
      if (it.seg === 'O') {
        nseq += 1; soma += it.valPagto
        linhas.push(buildLine({
          banco: BANCO, lote: loteNum, tipo: '3', nSeq: String(nseq), seg: 'O', mov: '000',
          codBarras: it.codBarras, nomeConc: it.nomeConc, dtVenc: it.dtVenc, dtPagto: it.dtPagto,
          valPagto: cents(it.valPagto), resto: truncPad(it.controle, 118),
        }, SEG_O))
      } else {
        nseq += 1; soma += it.valPagto
        linhas.push(buildLine({
          banco: BANCO, lote: loteNum, tipo: '3', nSeq: String(nseq), seg: 'J', mov: '000',
          codBarras: it.codBarras, nomeBenef: it.nomeBenef, dtVenc: it.dtVenc, valTitulo: cents(it.valTitulo),
          desconto: cents(it.desconto ?? 0), acrescimo: cents(it.acrescimo ?? 0), dtPagto: it.dtPagto,
          valPagto: cents(it.valPagto), qtdMoeda: cents(it.qtdMoeda ?? 0), seuNum: it.seuNum, resto: J_RESTO,
        }, SEG_J))
        nseq += 1
        const pref = ' 0' + (lote.formaPg === '47' ? '0' : '1') + '522'
        const tail = it.pixKey ? truncPad(it.pixKey, 109) : J52_BOLETO_TAIL
        linhas.push(buildLine({
          banco: BANCO, lote: loteNum, tipo: '3', nSeq: String(nseq), seg: 'J', pref,
          tpInscPag: '0', cnpjPag: e.cnpj, nomePag: e.nome, sepBenef: '2', tpInscBenef: '0',
          cnpjBenef: it.cnpjBenef, nomeBenef: it.nomeBenefFull, resto: tail,
        }, SEG_J52))
      }
    }
    const qtdReg = 1 /*header*/ + nseq + 1 /*trailer*/
    linhas.push(buildLine({
      banco: BANCO, lote: loteNum, tipo: '5', cnab1: SP(9), qtdReg: String(qtdReg),
      somaVal: cents(soma), resto: TRAILER_LOTE_RESTO,
    }, TRAILER_LOTE))
  })

  linhas.push(buildLine({
    banco: BANCO, lote: '9999', tipo: '9', cnab1: SP(9), qtdLotes: String(inp.lotes.length),
    qtdReg: String(linhas.length + 1), resto: TRAILER_ARQ_RESTO,
  }, TRAILER_ARQ))

  return joinArquivo(linhas)
}
