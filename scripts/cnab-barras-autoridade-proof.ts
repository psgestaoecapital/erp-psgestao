// PROVA (RD-38) — CÓDIGO DE BARRAS É AUTORIDADE DO BANCO EMISSOR: a PS armazena e repassa,
// NUNCA recalcula. Rejeição Sicredi "CA / código de barras inválido" no segmento J vinha de um
// erp_pagar com o barras TORTO (meio deslocado 1 dígito, pos 25-34 do barras). Crédito: Jordana.
//
// Esta prova fecha 4 asserções byte a byte, usando o caso real (nosso nº 131, R$1,79, venc 05/08/2026):
//   1. A LINHA DIGITÁVEL real do Sicoob, passada pelo nosso normalizador, reproduz EXATAMENTE o
//      BARRAS real do Sicoob. => a conversão de leitura (linhaParaBarras) está correta; o bug NÃO
//      estava nela, estava no DADO armazenado.
//   2. O barras real é reconhecido (DV mód 11 ok), com valor R$1,79 e vencimento 2026-08-05.
//   3. O barras TORTO também passa no DV geral (por isso a rejeição não era "óbvia") — prova de que
//      DV não detecta o deslocamento; só o banco (contra o boleto registrado) detecta => a regra é
//      usar o barras do banco, não confiar em "passou no DV".
//   4. mapearRemessaSicredi REPASSA o barras armazenado verbatim no item do segmento J (não recompõe).
//
// Rodar: npx tsx scripts/cnab-barras-autoridade-proof.ts
import { normalizarCodigoBarras, reconhecerBoleto } from '../src/lib/financeiro/boleto-parser'
import { mapearRemessaSicredi } from '../src/lib/banco/cnab240'
import type { ConfigSicoobDb, TituloPag } from '../src/lib/banco/cnab240/mapear'

// ── Dados reais do caso (nosso nº 131). A LINHA é a que a Jordana tem do Sicoob.
const LINHA_REAL_SICOOB: string = '75691303901579544303000001310010715290000000179' // 47 díg
const BARRAS_REAL_SICOOB: string = '75697152900000001791303915795443030000131001'    // 44 díg (autoridade)
const BARRAS_TORTO_ARMAZENADO: string = '75697152900000001791303901579544300000131001' // 44 díg (o que estava no erp_pagar)

let falhas = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) falhas++ }

// ── Asserção 1: linha real → normalizador → barras real (byte a byte)
const barrasDaLinha = normalizarCodigoBarras(LINHA_REAL_SICOOB)
console.log(`linha real (47) → normalizarCodigoBarras → ${barrasDaLinha}`)
console.log(`barras real Sicoob (esperado)             → ${BARRAS_REAL_SICOOB}`)
ok(barrasDaLinha === BARRAS_REAL_SICOOB,
  'A1 · normalizarCodigoBarras(linha real) === barras real do Sicoob (conversão correta)')

// ── Asserção 2: barras real é reconhecido, DV ok, valor e vencimento certos
const rec = reconhecerBoleto(BARRAS_REAL_SICOOB)
ok(rec.reconhecido && rec.tipo === 'boleto', 'A2a · barras real reconhecido como boleto (DV mód 11 ok)')
ok(rec.valor === 1.79, `A2b · valor lido = R$1,79 (lido: ${rec.valor})`)
ok(rec.vencimento === '2026-08-05', `A2c · vencimento lido = 2026-08-05 (lido: ${rec.vencimento})`)

// ── Asserção 3: o barras TORTO também passa no DV (por isso escapou) mas != banco
const recTorto = reconhecerBoleto(BARRAS_TORTO_ARMAZENADO)
ok(recTorto.reconhecido === true,
  'A3a · barras TORTO também passa no DV geral (DV não detecta o deslocamento — só o banco detecta)')
ok(BARRAS_TORTO_ARMAZENADO !== BARRAS_REAL_SICOOB,
  'A3b · barras TORTO != barras real do banco (é a diferença que o Sicredi rejeita com CA)')
// localiza a divergência (esperado: começa na pos 25 do barras, meio do campo livre)
let primeiraDif = -1
for (let i = 0; i < 44; i++) { if (BARRAS_TORTO_ARMAZENADO[i] !== BARRAS_REAL_SICOOB[i]) { primeiraDif = i + 1; break } }
ok(primeiraDif === 25, `A3c · 1ª divergência na posição ${primeiraDif} do barras (esperado 25 — meio do campo livre)`)

// ── Asserção 4: a remessa (segmento J) REPASSA o barras armazenado, não recompõe.
const cfg: ConfigSicoobDb = {
  cnpj: '11111111000191', cooperativa: '0313', agencia_dv: '1', conta: '99251-2', convenio: '6YT6',
  razao_social: 'PS GESTAO', endereco: 'RUA TESTE', cidade_estado: 'CIDADE, RS',
}
const tituloCorrigido: TituloPag[] = [{
  id: 'a0000000-0000-0000-0000-000000000131', forma_pagamento: 'boleto',
  codigo_barras: BARRAS_REAL_SICOOB, valor: 1.79, data_vencimento: '2026-08-05',
  numero_documento: '131', descricao: 'TESTE REMESSA', fornecedor: { pix: null, cnpj_cpf: '11111111000191', nome: 'PS GESTAO' },
}]
const res = mapearRemessaSicredi(cfg, tituloCorrigido, { dtPagto: '2026-08-05', dataGer: '05082026', horaGer: '120000', seqArq: 49 })
const itemJ = res.input?.lotes?.[0]?.itens?.[0]
ok(!!itemJ && itemJ.codBarras === BARRAS_REAL_SICOOB,
  `A4 · segmento J leva o barras armazenado verbatim (J.codBarras: ${itemJ?.codBarras ?? '—'})`)

console.log('')
if (falhas > 0) { console.error(`❌ PROVA FALHOU: ${falhas} asserção(ões) quebrada(s).`); process.exit(1) }
console.log('✅ PROVA OK — o barras do banco é reproduzível a partir da linha real, e a remessa o repassa sem recompor.')
