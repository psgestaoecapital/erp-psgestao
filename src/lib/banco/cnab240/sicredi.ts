// PERFIL SICREDI (banco 748 — NÃO confundir com Sicoob 756) para o motor CNAB 240 de PAGAMENTO.
// Mapas de campo + constantes MEDIDOS do arquivo real anonimizado (docs/cnab/cnab_pgto_748_sicredi_anon.rem,
// 66 linhas, 2 lotes, 30 boletos = par J000+J52). Provado byte a byte em scripts/cnab-gen-proof-sicredi.ts.
// NÃO toca no motor (engine.ts) nem no perfil Sicoob (sicoob.ts) — RD-52.
//
// Diferenças medidas vs Sicoob: banco 748; nomeBanco "SICREDI"; versão de arquivo 082; versão de lote 042;
// convênio/cedente ALFANUMÉRICO ("6YT6"); J52 sepBenef "1" + cauda "1000000000000100"; trailer de lote com
// resto próprio. Estrutura (numeração, lotes, trailers) é computada pelo gerador, igual ao Sicoob.
import { Field, buildLine, joinArquivo, truncPad, parseLine } from './engine'
import type { ArquivoInput, LoteInput, ItemJ, ItemO, EmpresaSicoob } from './sicoob'

// ---------------- MAPAS DE CAMPO (largura FEBRABAN; convênio é ALFA no Sicredi) ----------------
export const HEADER_ARQ: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['cnab1', 9, 'R'], ['tpInsc', 1, 'N'], ['cnpj', 14, 'N'],
  ['convenio', 20, 'A'], ['agCoop', 5, 'N'], ['dvAg', 1, 'A'], ['conta', 12, 'N'], ['dvCta', 1, 'A'], ['dvAgCta', 1, 'R'],
  ['nomeEmp', 30, 'A'], ['nomeBanco', 30, 'A'], ['cnab2', 10, 'R'], ['codRemessa', 1, 'N'], ['dataGer', 8, 'N'],
  ['horaGer', 6, 'N'], ['seqArq', 6, 'N'], ['versaoArq', 3, 'N'], ['densidade', 5, 'N'], ['resto', 69, 'R'],
]
export const HEADER_LOTE: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['tpOper', 1, 'A'], ['tpServ', 2, 'N'], ['formaPg', 2, 'N'],
  ['versaoLote', 3, 'N'], ['cnab1', 1, 'R'], ['tpInsc', 1, 'N'], ['cnpj', 14, 'N'], ['convenio', 20, 'A'], ['agCoop', 5, 'N'],
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
export const TRAILER_LOTE: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['cnab1', 9, 'R'], ['qtdReg', 6, 'N'], ['somaVal', 18, 'N'], ['resto', 199, 'R'],
]
export const TRAILER_ARQ: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['cnab1', 9, 'R'], ['qtdLotes', 6, 'N'], ['qtdReg', 6, 'N'], ['resto', 211, 'R'],
]

export function mapForLine(line: string): Field[] {
  const tipo = line[7]
  if (tipo === '0') return HEADER_ARQ
  if (tipo === '1') return HEADER_LOTE
  if (tipo === '5') return TRAILER_LOTE
  if (tipo === '9') return TRAILER_ARQ
  const seg = line[13]
  if (seg === 'O') return SEG_O
  if (seg === 'J') return line[14] === ' ' ? SEG_J52 : SEG_J
  throw new Error('registro CNAB Sicredi desconhecido: tipo=' + tipo + ' seg=' + seg)
}
export const SEG_O: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['nSeq', 5, 'N'], ['seg', 1, 'A'], ['mov', 3, 'N'],
  ['codBarras', 44, 'A'], ['nomeConc', 30, 'A'], ['dtVenc', 8, 'N'], ['dtPagto', 8, 'N'], ['valPagto', 15, 'N'], ['resto', 118, 'R'],
]

// ---------------- CONSTANTES DE LAYOUT (medidas do real) ----------------
const SP = (n: number) => ' '.repeat(n)
const BANCO = '748'
const J_RESTO = SP(20) + '09' + SP(16)                        // [203-240] constante em todo J000
const J52_TAIL = '1000000000000100' + SP(93)                  // [132-240] no J52 do Sicredi (Sicoob usa zeros)
const TRAILER_LOTE_RESTO = '100000000000010000000000' + SP(175) // [42-240] próprio do Sicredi
const TRAILER_ARQ_RESTO = '000000' + SP(205)                  // [30-240]

const cents = (n: number) => String(Math.round(n))

function enderecoBloco(e: EmpresaSicoob, formaPg: string): string {
  const ind = formaPg === '30' || formaPg === '31' ? SP(2) : '01'
  return (
    SP(40) + truncPad(e.logradouro, 30) + String(e.numero).replace(/\D/g, '').padStart(5, '0') +
    truncPad(e.complemento, 15) + truncPad(e.cidade, 20) + String(e.cep).replace(/\D/g, '').padStart(8, '0') +
    truncPad(e.uf, 2) + ind + SP(16)
  )
}

/**
 * Gera o arquivo de remessa CNAB 240 do SICREDI (banco 748) a partir de dados semânticos.
 * Boleto = par J000 (dados do pagamento) + J52 (CNPJ/nome do pagador e do beneficiário). Estrutura computada.
 */
export function buildArquivoSicredi(inp: ArquivoInput): string {
  const e = inp.empresa
  const emp = {
    banco: BANCO, tpInsc: '2', cnpj: e.cnpj, convenio: e.convenio, agCoop: e.agCoop, dvAg: e.dvAg,
    conta: e.conta, dvCta: e.dvCta, dvAgCta: ' ', nomeEmp: e.nome,
  }
  const linhas: string[] = []

  linhas.push(buildLine({
    ...emp, lote: '0', tipo: '0', cnab1: SP(9), cnab2: SP(10), nomeBanco: 'SICREDI',
    codRemessa: '1', dataGer: inp.dataGer, horaGer: inp.horaGer, seqArq: String(inp.seqArq),
    versaoArq: '082', densidade: '01600', resto: SP(69),
  }, HEADER_ARQ))

  inp.lotes.forEach((lote, li) => {
    const loteNum = String(li + 1).padStart(4, '0')
    linhas.push(buildLine({
      ...emp, lote: loteNum, tipo: '1', tpOper: 'C', tpServ: lote.tpServ, formaPg: lote.formaPg,
      versaoLote: '042', cnab1: ' ', resto: enderecoBloco(e, lote.formaPg),
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
        linhas.push(buildLine({
          banco: BANCO, lote: loteNum, tipo: '3', nSeq: String(nseq), seg: 'J', pref,
          tpInscPag: '0', cnpjPag: e.cnpj, nomePag: e.nome, sepBenef: '1', tpInscBenef: '0',
          cnpjBenef: it.cnpjBenef, nomeBenef: it.nomeBenefFull, resto: J52_TAIL,
        }, SEG_J52))
      }
    }
    const qtdReg = 1 + nseq + 1
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

/** Reconstrói o ArquivoInput semântico a partir de um .rem real do Sicredi (para o gen-proof byte a byte). */
export function reconstruirInputSicredi(raw: string): ArquivoInput {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
  const ha = parseLine(lines[0], HEADER_ARQ)
  const end = lines.find((l) => l[7] === '1')!
  const empresa: EmpresaSicoob = {
    cnpj: ha.cnpj, convenio: ha.convenio.replace(/ +$/, ''), agCoop: ha.agCoop, dvAg: ha.dvAg, conta: ha.conta, dvCta: ha.dvCta,
    nome: ha.nomeEmp, logradouro: end.slice(142, 172).replace(/ +$/, ''), numero: end.slice(172, 177),
    complemento: end.slice(177, 192).replace(/ +$/, ''), cidade: end.slice(192, 212).replace(/ +$/, ''),
    cep: end.slice(212, 220), uf: end.slice(220, 222),
  }
  const lotes: LoteInput[] = []
  let cur: LoteInput | null = null
  for (const l of lines) {
    const tipo = l[7]
    if (tipo === '1') { const h = parseLine(l, HEADER_LOTE); cur = { tpServ: h.tpServ, formaPg: h.formaPg, itens: [] }; lotes.push(cur) }
    else if (tipo === '3' && cur) {
      const rec = parseLine(l, mapForLine(l))
      if (rec.seg === 'O') {
        cur.itens.push({ seg: 'O', codBarras: rec.codBarras, nomeConc: rec.nomeConc, dtVenc: rec.dtVenc, dtPagto: rec.dtPagto, valPagto: parseInt(rec.valPagto, 10), controle: rec.resto.replace(/ +$/, '') } as ItemO)
      } else if (rec.seg === 'J' && l[14] !== ' ') {
        cur.itens.push({
          seg: 'J', codBarras: rec.codBarras, nomeBenef: rec.nomeBenef, dtVenc: rec.dtVenc,
          valTitulo: parseInt(rec.valTitulo, 10), valPagto: parseInt(rec.valPagto, 10),
          desconto: parseInt(rec.desconto, 10), acrescimo: parseInt(rec.acrescimo, 10), qtdMoeda: parseInt(rec.qtdMoeda, 10),
          dtPagto: rec.dtPagto, seuNum: rec.seuNum, cnpjBenef: '', nomeBenefFull: '',
        } as ItemJ)
      } else {
        const last = cur.itens[cur.itens.length - 1] as ItemJ
        last.cnpjBenef = rec.cnpjBenef
        last.nomeBenefFull = rec.nomeBenef
      }
    }
  }
  return { empresa, dataGer: ha.dataGer.padStart(8, '0'), horaGer: ha.horaGer.padStart(6, '0'), seqArq: parseInt(ha.seqArq, 10), lotes }
}
