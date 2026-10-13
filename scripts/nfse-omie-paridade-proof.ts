// Prova do #90 paridade OMIE (RD-38, dry-run — SEM emitir): reproduz o payload da NFS-e 18 do OMIE
// (07.02.02, Porto Belo, obra c/ cObra, pAliq 3.68, retido pelo tomador, xInfComp "PERMUTA|", regApTribSN=1)
// e confere as tags do infDPS que divergiam na nossa nota 56. npx tsx scripts/nfse-omie-paridade-proof.ts
import { buildNacionalNFSePayload } from '../src/lib/fiscal/providers/focusnfe'
import type { NFSeRequest } from '../src/lib/fiscal/types'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${d}`) } }

// Nota 18 do OMIE: 07.02.02 · Porto Belo (IBGE 4213609) · obra com CNO · SN opção 3 regApTribSN=1
// pAliq 3.68 · retido pelo tomador (tpRetISSQN=2) · xInfComp "PERMUTA|" · NBS 1.0107.20.00.
function reqNota18(): NFSeRequest {
  return {
    prestador: { cnpj: '51513485000158', inscricaoMunicipal: '205667', codigoMunicipio: '4213609' },
    tomador: { cnpj: '11111111000191', razaoSocial: 'Tomador PJ', endereco: { codigoMunicipio: '4213609', cep: '88210000', logradouro: 'Av Central', numero: '100', bairro: 'Centro' } },
    codigoServico: '070202',
    codigoNbs: '1.0107.20.00',
    descricaoServico: 'Servico de acabamento em obra',
    valorServicos: 1000,
    opcaoSimplesNacional: 3,
    regimeApuracaoSN: 1,
    aliquotaISSSN: 3.68,           // pAliq informado pelo emitente
    tipoRetencaoISS: 2,            // retido pelo tomador
    observacoes: 'PERMUTA|',       // xInfComp
    obra: { cno: '90.011.41292/78', codigoMunicipio: '4213609' },  // cObra + cLocIncid (município da obra)
  } as NFSeRequest
}

console.log('\n=== Paridade com o XML 18 do OMIE (tags do infDPS) ===')
const p18 = buildNacionalNFSePayload(reqNota18())
check('pAliq (percentual_aliquota_relativa_municipio) = 3.68', p18.percentual_aliquota_relativa_municipio === 3.68, String(p18.percentual_aliquota_relativa_municipio))
check('tpRetISSQN (tipo_retencao_iss) = 2 (retido tomador)', p18.tipo_retencao_iss === 2, String(p18.tipo_retencao_iss))
check('regApTribSN (regime_tributario_simples_nacional) = 1', p18.regime_tributario_simples_nacional === 1)
check('xInfComp (informacoes_complementares) = "PERMUTA|"', p18.informacoes_complementares === 'PERMUTA|')
check('cObra (codigo_obra) presente, sem endereço de obra', p18.codigo_obra === '90.011.41292/78' && !('cep_obra' in p18))
check('cLocIncid (codigo_municipio_prestacao) = município da obra 4213609', p18.codigo_municipio_prestacao === 4213609)
check('cTribNac (codigo_tributacao_nacional_iss) = 070202', p18.codigo_tributacao_nacional_iss === '070202')
check('NBS (codigo_nbs) = 1.0107.20.00', p18.codigo_nbs === '1.0107.20.00')
check('descrição = texto do serviço (não "Pedido …")', p18.descricao_servico === 'Servico de acabamento em obra')

console.log('\n=== Regime 2 (ISS por fora) → NÃO envia pAliq (segue a alíquota municipal) ===')
const p2 = buildNacionalNFSePayload({ ...reqNota18(), regimeApuracaoSN: 2, aliquotaISSSN: 3.68 })
check('regime 2 → sem percentual_aliquota_relativa_municipio', !('percentual_aliquota_relativa_municipio' in p2))

console.log('\n=== Regime 1 SEM alíquota (a rota bloqueia; no builder a chave não entra) ===')
const pSem = buildNacionalNFSePayload({ ...reqNota18(), aliquotaISSSN: null })
check('regime 1 sem alíquota → sem pAliq no payload', !('percentual_aliquota_relativa_municipio' in pSem))

console.log('\n=== Retenção default (nada escolhido) = 1 (não retido) ===')
const pDef = buildNacionalNFSePayload({ ...reqNota18(), tipoRetencaoISS: undefined, retemIss: false })
check('tipo_retencao_iss default = 1', pDef.tipo_retencao_iss === 1)
const p3 = buildNacionalNFSePayload({ ...reqNota18(), tipoRetencaoISS: 3 })
check('tipo_retencao_iss = 3 (intermediário)', p3.tipo_retencao_iss === 3)

console.log(`\n=== RESULTADO: ${pass} passaram, ${fail} falharam ===`)
process.exit(fail === 0 ? 0 : 1)
