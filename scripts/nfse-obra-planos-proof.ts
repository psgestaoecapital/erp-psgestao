// #90 · prova do grupo de obra em campos PLANOS (layout NACIONAL da Focus). Dry-run, SEM enviar nada.
// Rodar: npx tsx scripts/nfse-obra-planos-proof.ts
import { buildNacionalNFSePayload } from '../src/lib/fiscal/providers/focusnfe'
import type { NFSeRequest } from '../src/lib/fiscal/types'

const base = {
  prestador: { cnpj: '12345678000199', codigoMunicipio: '4217204' },
  tomador: { documento: '12345678000100', razaoSocial: '[TESTE] Tomador', endereco: { cep: '89900000', logradouro: 'Rua X', numero: '1', bairro: 'Centro', codigoMunicipio: '4217204', uf: 'SC' } },
  codigoServico: '070202', descricaoServico: 'Servico de teste', valorServicos: 1000,
  retemIss: false, opcaoSimplesNacional: 3, regimeApuracaoSN: 1, percentualTribSN: 6,
}

let ok = 0, fail = 0
function check(nome: string, cond: boolean, got: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) } else { fail++; console.log(`  ❌ ${nome} — obtido: ${JSON.stringify(got)}`) }
}

// Caso 1 — a nota R.R rejeitada de 18/09 09:56 (endereço, sem CNO): Rua Marques do Herval, 3249, São Jorge, 89900000
const reqEndereco = { ...base, obra: { cep: '89900000', logradouro: 'Rua Marques do Herval', numero: '3249', bairro: 'São Jorge', codigoMunicipio: '4217204' } } as unknown as NFSeRequest
const pEnd = buildNacionalNFSePayload(reqEndereco)
console.log('Caso R.R (endereço, sem CNO) — payload dry-run:')
console.log(JSON.stringify({ codigo_obra: pEnd.codigo_obra, inscricao_imobiliaria: pEnd.inscricao_imobiliaria, cep_obra: pEnd.cep_obra, logradouro_obra: pEnd.logradouro_obra, numero_obra: pEnd.numero_obra, bairro_obra: pEnd.bairro_obra, codigo_municipio_prestacao: pEnd.codigo_municipio_prestacao, obra: pEnd.obra, construcao_civil: pEnd.construcao_civil }, null, 1))
check('sem chave aninhada "obra"', !('obra' in pEnd), pEnd.obra)
check('sem chave "construcao_civil"', !('construcao_civil' in pEnd), (pEnd as Record<string,unknown>).construcao_civil)
check('cep_obra plano = 89900000', pEnd.cep_obra === '89900000', pEnd.cep_obra)
check('logradouro_obra plano', pEnd.logradouro_obra === 'Rua Marques do Herval', pEnd.logradouro_obra)
check('numero_obra plano', pEnd.numero_obra === '3249', pEnd.numero_obra)
check('bairro_obra plano', pEnd.bairro_obra === 'São Jorge', pEnd.bairro_obra)
check('codigo_municipio_prestacao (cLocIncid) = 4217204', pEnd.codigo_municipio_prestacao === 4217204, pEnd.codigo_municipio_prestacao)

// Caso 2 — só CNO → só codigo_obra, sem endereço de obra
const reqCno = { ...base, obra: { cno: '12.345.67890/12', codigoMunicipio: '4217204' } } as unknown as NFSeRequest
const pCno = buildNacionalNFSePayload(reqCno)
console.log('\nCaso CNO — payload dry-run:')
console.log(JSON.stringify({ codigo_obra: pCno.codigo_obra, cep_obra: pCno.cep_obra, obra: pCno.obra }, null, 1))
check('CNO → codigo_obra preenchido', pCno.codigo_obra === '12.345.67890/12', pCno.codigo_obra)
check('CNO → sem cep_obra/endereço', pCno.cep_obra === undefined && pCno.logradouro_obra === undefined, { cep_obra: pCno.cep_obra })
check('CNO → sem chave aninhada "obra"', !('obra' in pCno), pCno.obra)

// Caso 3 — inscrição imobiliária vai para inscricao_imobiliaria (NÃO para codigo_cib)
const reqInsc = { ...base, obra: { inscricaoImobiliaria: '123456', codigoMunicipio: '4217204' } } as unknown as NFSeRequest
const pInsc = buildNacionalNFSePayload(reqInsc)
check('inscricaoImobiliaria → inscricao_imobiliaria (não codigo_cib)', pInsc.inscricao_imobiliaria === '123456' && pInsc.codigo_cib === undefined && (pInsc as Record<string,unknown>).codigo_cib_obra === undefined, { inscricao_imobiliaria: pInsc.inscricao_imobiliaria, codigo_cib: pInsc.codigo_cib })

console.log(`\nDIFF vs payload_enviado da R.R (id 70c8b342, rejeitado E0370):`)
console.log('  ANTES (#1536): {"obra":{"endereco":{"cep":"89900000","bairro":"São Jorge","numero":"3249","logradouro":"Rua Marques do Herval"}}}  → Focus descartava a chave "obra"')
console.log('  DEPOIS (#90):  cep_obra/logradouro_obra/numero_obra/bairro_obra planos na raiz + codigo_municipio_prestacao 4217204, sem "obra"')

console.log(`\nResultado: ${ok} passaram, ${fail} falharam`)
process.exit(fail === 0 ? 0 : 1)
