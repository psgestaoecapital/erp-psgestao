// Emissão de NFS-e com o tomador do cadastro SEM endereço fiscal (caixa jordana-code 25fac6b6, item 4 — Pdois/Gean):
// o bloco "Falta no cadastro do tomador" (TomadorEnderecoPendente) pede o CEP/cidade ali mesmo e GRAVA no cliente; a
// emissão seguinte lê o cadastro completo. Nenhuma demo tem emissor fiscal configurado (RD-92: nada é emitido), então a
// prova é no banco, com as MESMAS regras da tela e da rota: pendenciasEnderecoTomador (o que o bloco pede), o patch que o
// bloco grava, o IBGE da tabela oficial e o filtro da rota (filtroDocumentoCliente + cadastro inativado fora).
// Demonstração Comércio (GE); clientes de teste criados e removidos no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada } from '../../support/api'
import { enderecoFiscalDoCliente, filtroDocumentoCliente, pendenciasEnderecoTomador, type ClienteEndereco } from '../../../src/lib/fiscal/tomadorEndereco'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString().slice(-6)
const CNPJ = `12${RUN}000150`.slice(0, 14)
const CNPJ_INATIVO = `13${RUN}000140`.slice(0, 14)
const CAMPOS = 'logradouro,endereco,numero,complemento,bairro,cidade,uf,cep,codigo_ibge_municipio'
const criados: string[] = []

async function buscarComoARota(doc: string) {
  const filtro = filtroDocumentoCliente(doc)
  expect(filtro, 'documento válido gera filtro').toBeTruthy()
  return dbSelect<ClienteEndereco>('erp_clientes',
    `company_id=eq.${DEMO_GE}&ativo=not.is.false&or=(${encodeURIComponent(filtro!)})&select=${CAMPOS}&limit=1`)
}

test.describe('NFS-e · tomador sem IBGE: pede o CEP/cidade na emissão e grava no cliente', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    // como o caso real: cliente cadastrado só com nome e CNPJ (sem endereço) — a emissão nacional parava
    const a = await dbInsert<{ id: string }>('erp_clientes', { company_id: DEMO_GE, nome_fantasia: `E2E tomador pendente ${RUN}`, cpf_cnpj: CNPJ })
    // duplicata INATIVADA com endereço completo: nunca pode ser a escolhida pela rota
    const b = await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_GE, nome_fantasia: `E2E tomador inativo ${RUN}`, cpf_cnpj: CNPJ_INATIVO, ativo: false,
      logradouro: 'RUA TESTE', numero: '1', bairro: 'CENTRO', cidade: 'LAGES', uf: 'SC', cep: '88517625', codigo_ibge_municipio: '4209300',
    })
    criados.push(a.id, b.id)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfse-tomador-endereco-pendente', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { for (const id of criados) await dbDelete('erp_clientes', `id=eq.${id}`).catch(() => {}) })

  test('caminho principal: sem endereço → o bloco pede → grava → a rota monta o endereço fiscal', async () => {
    const [antes] = await buscarComoARota(CNPJ)
    expect(antes, 'a rota acha o cliente pelo CNPJ').toBeTruthy()
    expect(enderecoFiscalDoCliente(antes), 'antes: sem endereço fiscal (a emissão nacional parava)').toBeNull()
    expect(pendenciasEnderecoTomador(antes)).toEqual(['código IBGE do município', 'logradouro', 'número'])

    // o IBGE que o bloco grava vem da tabela oficial (CEP/cidade → código conferido), nunca digitado
    const [mun] = await dbSelect<{ codigo_ibge: string }>('erp_gov_nfse_municipios', 'uf=eq.MS&codigo_ibge=eq.5005707&select=codigo_ibge')
    expect(mun?.codigo_ibge, 'Naviraí/MS existe na tabela oficial').toBe('5005707')
    await dbPatch('erp_clientes', `id=eq.${criados[0]}`, {
      cep: '79950000', logradouro: 'RUA BERTILA FRIEDRICH', numero: '31', bairro: 'CENTRO', cidade: 'Naviraí', uf: 'MS', codigo_ibge_municipio: mun.codigo_ibge,
    })

    const [depois] = await buscarComoARota(CNPJ)
    expect(pendenciasEnderecoTomador(depois), 'depois de gravar: nada pendente (o bloco some)').toEqual([])
    const end = enderecoFiscalDoCliente(depois)
    expect(end?.codigoMunicipio).toBe('5005707')
    expect(end?.numero).toBe('31')
    expect(end?.uf).toBe('MS')
  })

  test('cadastro inativado (duplicata) não é usado pela emissão', async () => {
    const r = await buscarComoARota(CNPJ_INATIVO)
    expect(r.length, 'inativado fica fora: nem o bloco nem a rota usam').toBe(0)
  })
})
