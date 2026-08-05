// PROVA FIX2 + FIX3 (RD-38) — campos do HEADER de arquivo Sicredi que dependem de config/edição:
//  FIX2 · AGÊNCIA (posições 53-57 = agCoop) sai de `cooperativa` ('0313' → '00313'), NÃO do campo `agencia`
//         (que estava NULL — ConfigSicoobDb nem tem esse campo, o mapper não consegue ler a coluna). Confere
//         byte a byte contra o arquivo real da KGF.
//  FIX3 · NÚMERO SEQUENCIAL da remessa (NSA, posições 158-163 = seqArq) é EXATAMENTE o número passado em
//         opts.seqArq (o que a Jordana confirma na tela / semeado). Aqui passamos 48 e provamos '000048'.
//
// HEADER_ARQ (offsets): banco3+lote4+tipo1+cnab9+tpInsc1+cnpj14+convenio20 = 52 → agCoop [53-57];
//   ...+agCoop5+dvAg1+conta12+dvCta1+dvAgCta1+nomeEmp30+nomeBanco30+cnab2(10)+codRemessa1+dataGer8+horaGer6
//   = 157 → seqArq [158-163].
import { readFileSync, existsSync } from 'node:fs'
import { mapearRemessaSicredi, buildArquivoSicredi } from '../src/lib/banco/cnab240'
import type { ConfigSicoobDb, TituloPag } from '../src/lib/banco/cnab240/mapear'

// Config espelhando a linha REAL da KGF no banco (Sicredi 748) — coop 0313, sem `agencia` (nem existe no tipo).
const cfg: ConfigSicoobDb = {
  cnpj: '11111111000191', cooperativa: '0313', agencia_dv: '1', conta: '99251-2', convenio: '6YT6',
  razao_social: 'KGF AUTOCENTER', endereco: 'RUA TESTE', cidade_estado: 'CIDADE, RS',
}
// Um boleto sintético (código de barras fabricado, 44 díg, NÃO tributo) — nenhum dado de terceiro real.
const titulos: TituloPag[] = [{
  id: 'a0000000-0000-0000-0000-000000000001', forma_pagamento: 'boleto',
  codigo_barras: '74891234500000100000000000000000000000000001', valor: 10.0,
  data_vencimento: '2026-08-20', numero_documento: 'PROVA1', descricao: 'PROVA AGENCIA',
  fornecedor: { pix: null, cnpj_cpf: '22222222000122', nome: 'FORNECEDOR PROVA' },
}]
const NSA = 48
const opts = { dtPagto: '2026-08-05', dataGer: '05082026', horaGer: '120000', seqArq: NSA }

const res = mapearRemessaSicredi(cfg, titulos, opts)
if (!res.input) { console.error('❌ mapper não gerou input:', res.erros); process.exit(1) }

const arquivo = buildArquivoSicredi(res.input)
const header = arquivo.split(/\r\n|\n/)[0]
const agHeader = header.slice(52, 57)      // posições 53-57 (0-indexed 52..56)
console.log(`Header agCoop (pos 53-57) = ${JSON.stringify(agHeader)}  (esperado "00313")`)

// FIX3 · NSA (número sequencial da remessa) nas posições 158-163.
const nsaHeader = header.slice(157, 163)   // posições 158-163 (0-indexed 157..162)
const nsaEsper = String(NSA).padStart(6, '0')
console.log(`Header NSA (pos 158-163) = ${JSON.stringify(nsaHeader)}  (esperado ${JSON.stringify(nsaEsper)} p/ remessa ${NSA})`)

let ok = agHeader === '00313' && nsaHeader === nsaEsper
if (agHeader !== '00313') console.error('❌ agência do header não é 00313 — NÃO liberar.')
if (nsaHeader !== nsaEsper) console.error(`❌ NSA do header não reflete o número ${NSA} — NÃO liberar.`)

// Se o arquivo REAL estiver presente, confere que a AGÊNCIA do header gerado == a do real (byte a byte).
// O NSA NÃO é comparado ao real (o arquivo real é de outra remessa/número) — a prova do NSA é reflexiva.
const REAL = '.cnab-real/sicredi_real.rem'
if (existsSync(REAL)) {
  const realHeader = readFileSync(REAL, 'latin1').split(/\r\n|\n/)[0]
  const agReal = realHeader.slice(52, 57)
  const match = agReal === agHeader
  console.log(`Header agCoop do ARQUIVO REAL = ${JSON.stringify(agReal)} · bate com o gerado: ${match}`)
  ok = ok && match
} else {
  console.log('(arquivo real ausente — comparação contra 6YT63101 pulada; a asserção "00313" já cobre o FIX2.)')
}

console.log(ok
  ? `\n✅ FIX2+FIX3: agência do header vem da cooperativa ("00313", = arquivo real) e o NSA reflete o número editado (${nsaEsper}) — RD-38.`
  : '\n❌ FALHOU — header divergente (agência e/ou NSA).')
process.exit(ok ? 0 : 1)
