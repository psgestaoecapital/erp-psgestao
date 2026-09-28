// NFS-e avulsa: a tela manda só nome + CNPJ do tomador; a rota completa o ENDEREÇO a partir do cadastro de clientes
// da empresa (o leiaute nacional exige município e número). O e-mail do cadastro NÃO vai para a nota (CEO 28/09).
// Nenhuma demo tem emissor fiscal configurado, então a prova é no banco real, com o MESMO filtro que a rota usa
// (filtroDocumentoCliente) — inclusive o CNPJ formatado com '.', '/' e '-' dentro da sintaxe do filtro.
// Demonstração Comércio (GE); cliente de teste criado e removido no fim. Nada é emitido (RD-92).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'
import { enderecoFiscalDoCliente, filtroDocumentoCliente, type ClienteEndereco } from '../../../src/lib/fiscal/tomadorEndereco'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString().slice(-6)
const CNPJ = `11${RUN}000190`.slice(0, 14)                     // 14 dígitos, só da execução
const CNPJ_FMT = `${CNPJ.slice(0, 2)}.${CNPJ.slice(2, 5)}.${CNPJ.slice(5, 8)}/${CNPJ.slice(8, 12)}-${CNPJ.slice(12)}`
let clienteId = ''

async function buscarComoARota(doc: string) {
  const filtro = filtroDocumentoCliente(doc)
  expect(filtro, 'documento válido gera filtro').toBeTruthy()
  return dbSelect<ClienteEndereco & { email: string | null }>('erp_clientes',
    `company_id=eq.${DEMO_GE}&or=(${encodeURIComponent(filtro!)})&select=logradouro,endereco,numero,complemento,bairro,cidade,uf,cep,codigo_ibge_municipio,email&limit=1`)
}

test.describe('NFS-e avulsa · endereço do tomador vem do cadastro do cliente', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const c = await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_GE, nome_fantasia: `E2E tomador ${RUN}`, cpf_cnpj: CNPJ_FMT, email: `e2e-${RUN}@exemplo.invalid`,
      logradouro: 'RUA TESTE', numero: '105', bairro: 'CENTRO', cidade: 'LAGES', uf: 'SC', cep: '88517-625', codigo_ibge_municipio: '4209300',
    })
    clienteId = c.id
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfse-avulsa-endereco-tomador', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { if (clienteId) await dbDelete('erp_clientes', `id=eq.${clienteId}`).catch(() => {}) })

  test('caminho principal: tela manda só os dígitos, cadastro guardado formatado → endereço completo, sem e-mail', async () => {
    const r = await buscarComoARota(CNPJ)
    expect(r.length, 'acha o cliente pelo CNPJ sem máscara mesmo guardado com máscara').toBe(1)
    const end = enderecoFiscalDoCliente(r[0])
    expect(end?.codigoMunicipio).toBe('4209300')
    expect(end?.numero).toBe('105')
    expect(end?.cep).toBe('88517625')
    expect(JSON.stringify(end), 'o e-mail do cadastro não entra no endereço da nota').not.toContain('@')
  })

  test('documento de outra empresa ou inexistente não traz endereço', async () => {
    const r = await buscarComoARota('99999999000191')
    expect(r.length).toBe(0)
    expect(enderecoFiscalDoCliente(r[0] ?? null)).toBeNull()
  })
})
