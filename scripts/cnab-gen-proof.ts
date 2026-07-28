/* eslint-disable no-console */
// PROVA DE GERAÇÃO (RD-38): reconstrói os .rem reais a partir de dados SEMÂNTICOS.
// Diferente do round-trip: aqui o gerador COMPUTA nSeq, numeração de lotes e trailers (contagem/somatória)
// e preenche as constantes do perfil. Se o arquivo gerado == real byte a byte, a montagem está provada.
import { readFileSync } from 'node:fs'
import { parseLine } from '../src/lib/banco/cnab240/engine'
import {
  mapForLine, HEADER_ARQ, HEADER_LOTE, buildArquivoSicoob,
  type ArquivoInput, type LoteInput, type ItemJ, type ItemO,
} from '../src/lib/banco/cnab240/sicoob'

function reconstruirInput(raw: string): ArquivoInput {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
  const ha = parseLine(lines[0], HEADER_ARQ)
  const firstLote = parseLine(lines.find((l) => l[7] === '1')!, HEADER_LOTE)
  const end = lines.find((l) => l[7] === '1')! // fatia o bloco de endereço do header de lote
  const empresa = {
    cnpj: ha.cnpj, convenio: ha.convenio, agCoop: ha.agCoop, dvAg: ha.dvAg, conta: ha.conta, dvCta: ha.dvCta,
    nome: ha.nomeEmp,
    logradouro: end.slice(142, 172).replace(/ +$/, ''), numero: end.slice(172, 177),
    complemento: end.slice(177, 192).replace(/ +$/, ''), cidade: end.slice(192, 212).replace(/ +$/, ''),
    cep: end.slice(212, 220), uf: end.slice(220, 222),
  }
  void firstLote
  const lotes: LoteInput[] = []
  let cur: LoteInput | null = null
  for (const l of lines) {
    const tipo = l[7]
    if (tipo === '1') { const h = parseLine(l, HEADER_LOTE); cur = { tpServ: h.tpServ, formaPg: h.formaPg, itens: [] }; lotes.push(cur) }
    else if (tipo === '3' && cur) {
      const rec = parseLine(l, mapForLine(l))
      if (rec.seg === 'O') {
        const o: ItemO = { seg: 'O', codBarras: rec.codBarras, nomeConc: rec.nomeConc, dtVenc: rec.dtVenc, dtPagto: rec.dtPagto, valPagto: parseInt(rec.valPagto, 10), controle: rec.resto.replace(/ +$/, '') }
        cur.itens.push(o)
      } else if (rec.seg === 'J' && l[14] !== ' ') { // J principal → começa um item
        const it: ItemJ = {
          seg: 'J', codBarras: rec.codBarras, nomeBenef: rec.nomeBenef, dtVenc: rec.dtVenc,
          valTitulo: parseInt(rec.valTitulo, 10), valPagto: parseInt(rec.valPagto, 10),
          desconto: parseInt(rec.desconto, 10), acrescimo: parseInt(rec.acrescimo, 10), qtdMoeda: parseInt(rec.qtdMoeda, 10),
          dtPagto: rec.dtPagto, seuNum: rec.seuNum, cnpjBenef: '', nomeBenefFull: '',
        }
        cur.itens.push(it)
      } else { // J-52 → completa o último item J
        const last = cur.itens[cur.itens.length - 1] as ItemJ
        last.cnpjBenef = rec.cnpjBenef
        last.nomeBenefFull = rec.nomeBenef
        if (cur.formaPg === '47') last.pixKey = rec.resto.replace(/ +$/, '')
      }
    }
  }
  return { empresa, dataGer: ha.dataGer.padStart(8, '0'), horaGer: ha.horaGer.padStart(6, '0'), seqArq: parseInt(ha.seqArq, 10), lotes }
}

const files = ['docs/cnab/cnab_pgto_756_56979.rem', 'docs/cnab/cnab_pgto_756_63082.rem']
let ok = 0
for (const fp of files) {
  const real = readFileSync(fp, 'latin1')
  const gerado = buildArquivoSicoob(reconstruirInput(real))
  if (gerado === real) { ok++; console.log(`✅ ${fp}: gerado == real (byte a byte, ${real.length} bytes)`); continue }
  console.log(`❌ ${fp}: DIFERE (real=${real.length}B gerado=${gerado.length}B)`)
  for (let p = 0; p < Math.max(real.length, gerado.length); p++) {
    if (real[p] !== gerado[p]) {
      const ln = real.slice(0, p).split('\r\n').length
      console.log(`   1ª divergência byte ${p} (linha ~${ln}): real=${JSON.stringify(real[p])} gerado=${JSON.stringify(gerado[p])}`)
      console.log('   real   :', JSON.stringify(real.slice(p - 20 < 0 ? 0 : p - 20, p + 20)))
      console.log('   gerado :', JSON.stringify(gerado.slice(p - 20 < 0 ? 0 : p - 20, p + 20)))
      break
    }
  }
}
console.log(`\n${ok}/${files.length} arquivos reconstruídos byte a byte a partir de dados semânticos.`)
process.exit(ok === files.length ? 0 : 1)
