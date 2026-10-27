/**
 * Gate de build: NFS-e avulsa completa o ENDEREÇO do tomador a partir do cadastro de clientes (nunca o e-mail).
 *   tsx scripts/check-nfse-tomador-endereco.ts
 */
import { enderecoFiscalDoCliente, escolherCadastroTomador, filtroCadastroTomador, filtroDocumentoCliente, pendenciasEnderecoTomador, variantesDocumento, type CadastroTomador } from '../../src/lib/fiscal/tomadorEndereco'

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

// 4) QUAL cadastro é o tomador (caixa jordana-code 3352399e — OS-2026-0198 da Gean, tomador FC Pisos). O caso real:
//    o ativo (CNPJ só dígitos, endereço completo) e o duplicado INATIVO (CNPJ com pontuação, sem endereço).
const ativo: CadastroTomador = { id: 'd0e668bc-9c11-4831-89e1-0ade9be56fa7', ativo: true, razao_social: 'FC PISOS LTDA', cnpj_cpf: '25277862000197', cpf_cnpj: '25.277.862/0001-97',
  logradouro: 'RUA BERTILA FRIEDRICH', numero: '31', cidade: 'Iporã do Oeste', uf: 'SC', codigo_ibge_municipio: '4207650' }
const inativo: CadastroTomador = { id: 'dc836ebf-7215-4be6-b860-7e7bcca6a22d', ativo: false, razao_social: 'FC PISOS', cnpj_cpf: '25.277.862/0001-97', cpf_cnpj: '25.277.862/0001-97' }
const DOC = '25277862000197'
for (const ordem of [[inativo, ativo], [ativo, inativo]]) {
  const e1 = escolherCadastroTomador(ordem, DOC, ativo.id)
  ok(e1.tipo === 'cliente' && e1.cliente.id === ativo.id && e1.origem === 'cliente_da_operacao', `cliente da OS manda, em qualquer ordem do banco (inativo ${ordem[0] === inativo ? 'primeiro' : 'depois'})`)
  const e2 = escolherCadastroTomador(ordem, DOC, null)
  ok(e2.tipo === 'cliente' && e2.cliente.id === ativo.id && e2.origem === 'documento', 'sem cliente da OS: só o ATIVO pelo documento (o duplicado inativo nunca)')
}
const r0 = escolherCadastroTomador([inativo, ativo], DOC, ativo.id)
ok(r0.tipo === 'cliente' && enderecoFiscalDoCliente(r0.cliente)?.codigoMunicipio === '4207650', 'OS-2026-0198: a nota sai com o IBGE 4207650 do cadastro certo')
ok(escolherCadastroTomador([inativo], DOC, null).tipo === 'nenhum', 'só o inativo com o documento → nenhum (não usa o inativo)')
const outroAtivo: CadastroTomador = { ...inativo, id: '11111111-2222-4333-8444-555555555555', ativo: true }
const amb = escolherCadastroTomador([ativo, outroAtivo], DOC, null)
ok(amb.tipo === 'ambiguo' && amb.candidatos.length === 2, 'dois ATIVOS com o mesmo CNPJ e sem cliente da OS → ambíguo (pede a escolha, não chuta)')
const esc = escolherCadastroTomador([ativo, outroAtivo], DOC, outroAtivo.id)
ok(esc.tipo === 'cliente' && esc.cliente.id === outroAtivo.id, 'depois da escolha na tela, usa o escolhido')
const trocou = escolherCadastroTomador([ativo, { ...outroAtivo, cnpj_cpf: '11222333000181', cpf_cnpj: null }], '11222333000181', ativo.id)
ok(trocou.tipo === 'cliente' && trocou.cliente.id === outroAtivo.id, 'pessoa trocou o CNPJ na tela → o cliente da OS não vale para outro documento')
const semDoc = escolherCadastroTomador([ativo], '', ativo.id)
ok(semDoc.tipo === 'cliente' && semDoc.cliente.id === ativo.id, 'OS sem documento na tela → o cliente da OS ainda é o tomador')
ok(filtroCadastroTomador(DOC, ativo.id)?.startsWith(`id.eq.${ativo.id},`) === true, 'filtro traz o cliente da OS por id E os do documento')
ok(filtroCadastroTomador(DOC, 'x),ativo.eq.true') === filtroDocumentoCliente(DOC), 'id fora do formato UUID nunca entra no filtro')
ok(filtroCadastroTomador('', null) === null, 'sem documento nem cliente → não procura')

if (falhas > 0) { console.error(`\n[check-nfse-tomador-endereco] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfse-tomador-endereco] endereço do tomador conferido.')
