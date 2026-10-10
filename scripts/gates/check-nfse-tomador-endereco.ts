/**
 * Gate de build: NFS-e avulsa completa o ENDEREÇO do tomador a partir do cadastro de clientes (nunca o e-mail).
 *   tsx scripts/check-nfse-tomador-endereco.ts
 */
import { enderecoFiscalDoCliente, filtroDocumentoCliente, pendenciasEnderecoTomador, variantesDocumento } from '../../src/lib/fiscal/tomadorEndereco'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

// 1) documento: acha com e sem máscara
ok(JSON.stringify(variantesDocumento('05.532.428/0001-07')) === JSON.stringify(['05532428000107', '05.532.428/0001-07']), 'CNPJ: dígitos e formatado')
ok(JSON.stringify(variantesDocumento('123.456.789-09')) === JSON.stringify(['12345678909', '123.456.789-09']), 'CPF: dígitos e formatado')
ok(variantesDocumento('123').length === 0 && filtroDocumentoCliente('') === null, 'documento inválido: não procura')
ok(filtroDocumentoCliente('05532428000107') === 'cpf_cnpj.eq."05532428000107",cnpj_cpf.eq."05532428000107",cpf_cnpj.eq."05.532.428/0001-07",cnpj_cpf.eq."05.532.428/0001-07"',
  'filtro: as duas colunas, valores entre aspas (o "." do CNPJ formatado não quebra a sintaxe)')

// 2) endereço: completo vira endereço fiscal; e-mail nunca entra
const cli = { logradouro: 'RUA A', numero: '105', bairro: 'CDL', cidade: 'LAGES', uf: 'sc', cep: '88517-625', codigo_ibge_municipio: '4209300', email: 'x@y.com' }
const e = enderecoFiscalDoCliente(cli)
ok(!!e && e.codigoMunicipio === '4209300' && e.numero === '105' && e.cep === '88517625' && e.uf === 'SC', 'cadastro completo → endereço fiscal (IBGE, número, CEP só dígitos)')
ok(!!e && !('email' in (e as object)), 'o e-mail do cadastro NÃO vai para a nota')
ok(enderecoFiscalDoCliente({ ...cli, codigo_ibge_municipio: null }) === null, 'sem IBGE → null (a guarda da rota continua pedindo o cadastro)')
ok(enderecoFiscalDoCliente({ ...cli, numero: '' }) === null, 'sem número → null')
ok(enderecoFiscalDoCliente({ ...cli, logradouro: null, endereco: 'AV B' })?.logradouro === 'AV B', 'usa "endereco" quando não há "logradouro"')

// 3) pendências (tela de emissão pede ali mesmo e grava no cliente — caixa jordana-code 25fac6b6, item 4)
ok(pendenciasEnderecoTomador(cli).length === 0, 'cadastro completo → nada pendente (o bloco não aparece)')
ok(JSON.stringify(pendenciasEnderecoTomador({ ...cli, codigo_ibge_municipio: null })) === JSON.stringify(['código IBGE do município']), 'sem IBGE → pede só o município')
ok(JSON.stringify(pendenciasEnderecoTomador({ cidade: 'Naviraí', uf: 'MS' })) === JSON.stringify(['código IBGE do município', 'logradouro', 'número']), 'só cidade/UF → pede IBGE, logradouro e número')
ok(pendenciasEnderecoTomador(null).length === 0, 'tomador fora do cadastro → nada a gravar no cliente')
ok(pendenciasEnderecoTomador({ ...cli, codigo_ibge_municipio: '42093' }).includes('código IBGE do município'), 'IBGE com menos de 7 dígitos conta como faltando')
// o que falta aqui é exatamente o que faz enderecoFiscalDoCliente devolver null (as duas regras não podem divergir)
for (const v of [cli, { ...cli, numero: null }, { ...cli, codigo_ibge_municipio: '' }, { ...cli, logradouro: null, endereco: null }]) {
  ok((pendenciasEnderecoTomador(v).length === 0) === (enderecoFiscalDoCliente(v) !== null), `pendências e endereço fiscal concordam (${JSON.stringify(pendenciasEnderecoTomador(v))})`)
}

if (falhas > 0) { console.error(`\n[check-nfse-tomador-endereco] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfse-tomador-endereco] endereço do tomador conferido.')
