// PROVA FIX2 (RD-38) — a AGÊNCIA no header do CNAB (posições 53-57 = campo agCoop) sai da config do banco
// e bate com o arquivo real da KGF (agência 0313 → '00313'). O ponto do SPEC: o campo `agencia` do banco
// estava NULL; era preciso garantir que o gerador NÃO depende dele. Aqui provamos que a agência do header
// vem de `cooperativa` (ConfigSicoobDb nem tem campo `agencia` — o mapper não consegue ler a coluna NULL).
//
// Caminho provado: cfg.cooperativa='0313' -> mapearRemessaSicredi (empresa.agCoop) -> buildArquivoSicredi
// (HEADER_ARQ: banco3+lote4+tipo1+cnab9+tpInsc1+cnpj14+convenio20 = 52; agCoop nas posições 53-57).
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
const opts = { dtPagto: '2026-08-05', dataGer: '05082026', horaGer: '120000', seqArq: 1 }

const res = mapearRemessaSicredi(cfg, titulos, opts)
if (!res.input) { console.error('❌ mapper não gerou input:', res.erros); process.exit(1) }

const arquivo = buildArquivoSicredi(res.input)
const header = arquivo.split(/\r\n|\n/)[0]
const agHeader = header.slice(52, 57)      // posições 53-57 (0-indexed 52..56)
console.log(`Header agCoop (pos 53-57) = ${JSON.stringify(agHeader)}  (esperado "00313")`)

let ok = agHeader === '00313'
if (!ok) console.error('❌ agência do header não é 00313 — NÃO liberar.')

// Se o arquivo REAL estiver presente, confere que a agência do header gerado == a do real (byte a byte).
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
  ? '\n✅ FIX2: a agência (0313) do header vem da cooperativa e monta "00313" — idêntica ao arquivo real (RD-38).'
  : '\n❌ FIX2 FALHOU — agência divergente.')
process.exit(ok ? 0 : 1)
