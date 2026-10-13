// PERFIL SICREDI (banco 748 — NÃO confundir com Sicoob 756) para o motor CNAB 240 de PAGAMENTO.
// Mapas + constantes MEDIDOS do arquivo real anonimizado (docs/cnab/cnab_pgto_748_sicredi_anon.rem,
// 66 linhas, 2 lotes, 30 boletos = par J000+J52). Provado byte a byte em scripts/cnab-gen-proof-sicredi.ts.
// NÃO toca no motor (engine.ts) nem no perfil Sicoob (sicoob.ts) — RD-52. Tipos próprios (self-contained).
//
// Diferenças medidas vs Sicoob: banco 748; nomeBanco "SICREDI"; versão de arquivo 082; versão de lote 042;
// convênio/cedente ALFANUMÉRICO ("6YT6"). Estrutura (numeração, lotes, trailers) é computada pelo gerador.
// O J000 é totalmente modelado (código de barras, valor, datas, seu número; desconto/mora/moeda = 0).
// O corpo do beneficiário do J52 (nome/doc do fornecedor e sacador) é dado por-título → passthrough.
import { Field, buildLine, joinArquivo, truncPad, parseLine } from './engine'

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
// J52: cabeçalho estrutural + pagador; o corpo do beneficiário/sacador (a partir da pos 76) é passthrough.
export const SEG_J52: Field[] = [
  ['banco', 3, 'N'], ['lote', 4, 'N'], ['tipo', 1, 'N'], ['nSeq', 5, 'N'], ['seg', 1, 'A'], ['pref', 6, 'R'],
  ['tpInscPag', 1, 'R'], ['cnpjPag', 14, 'N'], ['nomePag', 40, 'A'], ['benefBody', 165, 'R'],
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
  if (seg === 'J') return line[14] === ' ' ? SEG_J52 : SEG_J
  throw new Error('registro CNAB Sicredi desconhecido: tipo=' + tipo + ' seg=' + seg)
}

// ---------------- CONSTANTES DE LAYOUT (medidas do real) ----------------
const SP = (n: number) => ' '.repeat(n)
const BANCO = '748'
const J_RESTO = SP(20) + '09' + SP(16)                 // [203-240] constante em todo J000
const TRAILER_LOTE_RESTO = '0'.repeat(24) + SP(175)    // [42-240] zeros (igual ao Sicoob no arquivo limpo)
const TRAILER_ARQ_RESTO = '000000' + SP(205)           // [30-240]

const cents = (n: number) => String(Math.round(n))

// ---------------- TIPOS DE ENTRADA (próprios do Sicredi) ----------------
export type EmpresaSicredi = {
  cnpj: string; convenio: string; agCoop: string; dvAg: string; conta: string; dvCta: string; nome: string
  logradouro: string; numero: string; complemento: string; cidade: string; cep: string; uf: string
}
export type ItemJSicredi = {
  codBarras: string; nomeBenef: string; dtVenc: string; valTitulo: number; valPagto: number
  desconto?: number; acrescimo?: number; qtdMoeda?: number; dtPagto: string; seuNum: string
  benefBody: string // [76-240] do J52: doc/nome do beneficiário e sacador (passthrough por título)
}
export type LoteInputSicredi = { tpServ: string; formaPg: string; itens: ItemJSicredi[] }
export type ArquivoInputSicredi = {
  empresa: EmpresaSicredi; nomePagador: string; dataGer: string; horaGer: string; seqArq: number; lotes: LoteInputSicredi[]
}

// Constrói o corpo do beneficiário do J52 [76-240] a partir do doc/nome do fornecedor — MEDIDO do
// arquivo real da KGF (6YT63101): tpInsc(1) + inscrição(15, zero-pad) + nome(40) + sacador tpInsc(1='0')
// + sacador inscr(15='0') + filler(93 espaços). CNPJ→'2', CPF (≤11 díg)→'1'. Provado byte a byte em
// scripts/cnab-mapear-proof-sicredi.ts contra cada J52 do arquivo real.
// Nome do arquivo de remessa no padrão exigido pelo Sicredi: EXATAMENTE 8 caracteres + ".REM" (maiúsculo),
// sem underscore/prefixo. O banco rejeita qualquer outra nomenclatura ("Somente XXXXXXXX.TXT ou XXXXXXXX.REM").
// Usamos o número da remessa (NSA) com zero-pad em 8 → 48 vira "00000048.REM" (nome = número, rastreável).
export function nomeArquivoRemessaSicredi(seq: number): string {
  return `${String(Math.trunc(seq)).padStart(8, '0').slice(-8)}.REM`
}

export function construirBenefBodySicredi(cnpjCpf: string, nome: string): string {
  const dig = (cnpjCpf || '').replace(/\D/g, '')
  const tpInsc = dig.length > 0 && dig.length <= 11 ? '1' : '2'
  const insc15 = dig.padStart(15, '0').slice(-15)
  const body = tpInsc + insc15 + truncPad(nome || '', 40) + '0' + '0'.repeat(15) + ' '.repeat(93)
  return body // 1 + 15 + 40 + 1 + 15 + 93 = 165
}

function enderecoBloco(e: EmpresaSicredi, formaPg: string): string {
  const ind = formaPg === '30' || formaPg === '31' ? SP(2) : '01'
  return (
    SP(40) + truncPad(e.logradouro, 30) + String(e.numero).replace(/\D/g, '').padStart(5, '0') +
    truncPad(e.complemento, 15) + truncPad(e.cidade, 20) + String(e.cep).replace(/\D/g, '').padStart(8, '0') +
    truncPad(e.uf, 2) + ind + SP(16)
  )
}

/** Gera o arquivo de remessa CNAB 240 do SICREDI (banco 748) a partir de dados semânticos. */
export function buildArquivoSicredi(inp: ArquivoInputSicredi): string {
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
        tpInscPag: '0', cnpjPag: e.cnpj, nomePag: inp.nomePagador, benefBody: it.benefBody,
      }, SEG_J52))
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
export function reconstruirInputSicredi(raw: string): ArquivoInputSicredi {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
  const ha = parseLine(lines[0], HEADER_ARQ)
  const end = lines.find((l) => l[7] === '1')!
  const primeiroJ52 = lines.find((l) => l[7] === '3' && l[13] === 'J' && l[14] === ' ')!
  const nomePagador = parseLine(primeiroJ52, SEG_J52).nomePag
  const empresa: EmpresaSicredi = {
    cnpj: ha.cnpj, convenio: ha.convenio.replace(/ +$/, ''), agCoop: ha.agCoop, dvAg: ha.dvAg, conta: ha.conta, dvCta: ha.dvCta,
    nome: ha.nomeEmp, logradouro: end.slice(142, 172).replace(/ +$/, ''), numero: end.slice(172, 177),
    complemento: end.slice(177, 192).replace(/ +$/, ''), cidade: end.slice(192, 212).replace(/ +$/, ''),
    cep: end.slice(212, 220), uf: end.slice(220, 222),
  }
  const lotes: LoteInputSicredi[] = []
  let cur: LoteInputSicredi | null = null
  for (const l of lines) {
    const tipo = l[7]
    if (tipo === '1') { const h = parseLine(l, HEADER_LOTE); cur = { tpServ: h.tpServ, formaPg: h.formaPg, itens: [] }; lotes.push(cur) }
    else if (tipo === '3' && cur && l[13] === 'J') {
      if (l[14] !== ' ') {
        const rec = parseLine(l, SEG_J)
        cur.itens.push({
          codBarras: rec.codBarras, nomeBenef: rec.nomeBenef, dtVenc: rec.dtVenc,
          valTitulo: parseInt(rec.valTitulo, 10), valPagto: parseInt(rec.valPagto, 10),
          desconto: parseInt(rec.desconto, 10), acrescimo: parseInt(rec.acrescimo, 10), qtdMoeda: parseInt(rec.qtdMoeda, 10),
          dtPagto: rec.dtPagto, seuNum: rec.seuNum, benefBody: '',
        })
      } else {
        const last = cur.itens[cur.itens.length - 1]
        last.benefBody = l.slice(75, 240) // [76-240]: doc/nome do beneficiário e sacador (passthrough)
      }
    }
  }
  return { empresa, nomePagador, dataGer: ha.dataGer.padStart(8, '0'), horaGer: ha.horaGer.padStart(6, '0'), seqArq: parseInt(ha.seqArq, 10), lotes }
}
