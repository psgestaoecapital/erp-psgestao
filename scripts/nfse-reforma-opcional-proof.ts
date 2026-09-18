// Prova do #90 / Focus #242149: campos da Reforma Tributária (IBS/CBS) OPCIONAIS e desligados por
// padrão no layout NFS-e Nacional. Config vazia → JSON idêntico ao atual (diff zero); config preenchida
// → os 5 campos aparecem na raiz. Nenhum valor default no código. npx tsx scripts/nfse-reforma-opcional-proof.ts
import { buildNacionalNFSePayload } from '../src/lib/fiscal/providers/focusnfe'
import type { NFSeRequest } from '../src/lib/fiscal/types'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${d}`) } }

// Base = a nota R.R de 18/09 (07.02.02, São Miguel do Oeste, obra c/ endereço). SN opção 3.
function baseReq(): NFSeRequest {
  return {
    prestador: { cnpj: '51513485000158', inscricaoMunicipal: '205667', codigoMunicipio: '4217204' },
    tomador: { cpf: '00000000000', razaoSocial: 'Tomador Teste', endereco: { codigoMunicipio: '4217204', cep: '89900000', logradouro: 'Rua X', numero: '1', bairro: 'Centro' } },
    codigoServico: '070202',
    descricaoServico: 'Servico de construcao civil',
    valorServicos: 2,
    opcaoSimplesNacional: 3,
    regimeApuracaoSN: 2,
    percentualTribSN: 4.02,
    obra: { cep: '89900000', logradouro: 'Rua Marques do Herval', numero: '3249', bairro: 'Sao Jorge', codigoMunicipio: '4217204' },
  } as NFSeRequest
}

const CHAVES_REFORMA = ['finalidade_emissao','consumidor_final','indicador_destinatario','ibs_cbs_situacao_tributaria','ibs_cbs_classificacao_tributaria']

console.log('\n=== (1) Config vazia → diff zero (nenhuma chave da reforma) ===')
const semReforma = buildNacionalNFSePayload(baseReq())
const reformaUndef = buildNacionalNFSePayload({ ...baseReq(), reforma: undefined })
const reformaTudoNull = buildNacionalNFSePayload({ ...baseReq(), reforma: { finalidadeEmissao: null, consumidorFinal: null, indicadorDestinatario: null, ibsCbsCst: null, ibsCbsClassifTrib: null } })
check('nenhuma chave da reforma no payload base', CHAVES_REFORMA.every((k) => !(k in semReforma)))
check('reforma:undefined === base (diff zero)', JSON.stringify(reformaUndef) === JSON.stringify(semReforma))
check('reforma com tudo null === base (diff zero)', JSON.stringify(reformaTudoNull) === JSON.stringify(semReforma), JSON.stringify(reformaTudoNull))
check('ibs_cbs vazios ("") não entram', (() => { const p = buildNacionalNFSePayload({ ...baseReq(), reforma: { ibsCbsCst: '', ibsCbsClassifTrib: '  ' } }); return JSON.stringify(p) === JSON.stringify(semReforma) })())

console.log('\n=== (2) Config preenchida → os 5 campos aparecem na raiz, com os valores dados ===')
const cheia = buildNacionalNFSePayload({ ...baseReq(), reforma: {
  finalidadeEmissao: 0, consumidorFinal: 0, indicadorDestinatario: 0, ibsCbsCst: '000', ibsCbsClassifTrib: '000001' } })
check('finalidade_emissao=0', cheia.finalidade_emissao === 0)
check('consumidor_final=0', cheia.consumidor_final === 0)
check('indicador_destinatario=0', cheia.indicador_destinatario === 0)
check('ibs_cbs_situacao_tributaria="000"', cheia.ibs_cbs_situacao_tributaria === '000')
check('ibs_cbs_classificacao_tributaria="000001"', cheia.ibs_cbs_classificacao_tributaria === '000001')
check('demais chaves preservadas (obra/tomador/SN)', cheia.cep_obra === '89900000' && cheia.codigo_tributacao_nacional_iss === '070202' && cheia.percentual_total_tributos_simples_nacional === 4.02)

console.log('\n=== (3) Preenchimento PARCIAL → só os preenchidos entram ===')
const parcial = buildNacionalNFSePayload({ ...baseReq(), reforma: { consumidorFinal: 1 } })
check('só consumidor_final entra', parcial.consumidor_final === 1 && !('finalidade_emissao' in parcial) && !('ibs_cbs_situacao_tributaria' in parcial))

console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`)
process.exit(fail === 0 ? 0 : 1)
