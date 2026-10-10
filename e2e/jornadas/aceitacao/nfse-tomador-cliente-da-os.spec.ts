// Emissão de NFS-e escolhe o tomador CERTO (caixa jordana-code 3352399e — OS-2026-0198 da Gean, tomador FC Pisos): a
// Gean tinha dois cadastros com o mesmo CNPJ — o ativo (só dígitos, endereço e IBGE completos) e um duplicado INATIVO
// (CNPJ com pontuação, sem endereço). A emissão avulsa procurava só pelo CNPJ com limit(1) e pegava o duplicado:
// "falta o IBGE" com o cliente da OS completo. Agora: o cliente da OS manda; sem ele, só ativos pelo documento; dois
// ativos → a tela pede a escolha. Nenhuma demo tem emissor fiscal configurado (RD-92: nada é emitido), então a prova é no
// banco com a MESMA consulta da rota (filtroCadastroTomador + CAMPOS_CADASTRO_TOMADOR) e a MESMA regra
// (escolherCadastroTomador). Demonstração Comércio (GE); clientes de teste criados e removidos no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'
import {
  CAMPOS_CADASTRO_TOMADOR, enderecoFiscalDoCliente, escolherCadastroTomador, filtroCadastroTomador, type CadastroTomador,
} from '../../../src/lib/fiscal/tomadorEndereco'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString().slice(-6)
const CNPJ = `14${RUN}000130`.slice(0, 14)
const CNPJ_FMT = `${CNPJ.slice(0, 2)}.${CNPJ.slice(2, 5)}.${CNPJ.slice(5, 8)}/${CNPJ.slice(8, 12)}-${CNPJ.slice(12)}`
const ids: { ativo?: string; inativo?: string; outroAtivo?: string } = {}

async function comoARota(doc: string, clienteId?: string | null) {
  const filtro = filtroCadastroTomador(doc, clienteId)
  expect(filtro, 'documento/cliente válidos geram filtro').toBeTruthy()
  const rows = await dbSelect<CadastroTomador>('erp_clientes',
    `company_id=eq.${DEMO_GE}&or=(${encodeURIComponent(filtro!)})&select=${encodeURIComponent(CAMPOS_CADASTRO_TOMADOR.replace(/\s/g, ''))}&limit=20`)
  return escolherCadastroTomador(rows, doc, clienteId)
}

test.describe('NFS-e · o tomador é o cliente da OS, nunca o cadastro duplicado com o mesmo CNPJ', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    // como o caso real: o duplicado inativo é o mais ANTIGO (o que o limit(1) tendia a devolver)
    const inativo = await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_GE, nome_fantasia: `E2E FC duplicado ${RUN}`, razao_social: `E2E FC duplicado ${RUN}`, cnpj_cpf: CNPJ_FMT, cpf_cnpj: CNPJ_FMT, ativo: false,
    })
    const ativo = await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_GE, nome_fantasia: `E2E FC certo ${RUN}`, razao_social: `E2E FC certo ${RUN}`, cnpj_cpf: CNPJ, cpf_cnpj: CNPJ_FMT,
      logradouro: 'RUA BERTILA FRIEDRICH', numero: '31', bairro: 'CENTRO', cidade: 'Iporã do Oeste', uf: 'SC', cep: '89899000', codigo_ibge_municipio: '4207650',
    })
    ids.inativo = inativo.id; ids.ativo = ativo.id
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfse-tomador-cliente-da-os', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of Object.values(ids)) if (id) await dbDelete('erp_clientes', `id=eq.${id}`).catch(() => {})
  })

  test('caminho principal: OS com o cliente certo → a nota sai com o endereço e o IBGE dele', async () => {
    const e = await comoARota(CNPJ, ids.ativo)
    expect(e.tipo).toBe('cliente')
    if (e.tipo !== 'cliente') return
    expect(e.cliente.id, 'é o cliente da OS, não o duplicado').toBe(ids.ativo)
    expect(e.origem).toBe('cliente_da_operacao')
    expect(enderecoFiscalDoCliente(e.cliente)?.codigoMunicipio, 'IBGE do cadastro certo vai na nota').toBe('4207650')
  })

  test('sem o cliente da OS (avulsa): só o ATIVO pelo CNPJ — com ou sem pontuação', async () => {
    for (const doc of [CNPJ, CNPJ_FMT]) {
      const e = await comoARota(doc, null)
      expect(e.tipo, `documento ${doc}`).toBe('cliente')
      if (e.tipo === 'cliente') expect(e.cliente.id, 'o duplicado inativo nunca é escolhido').toBe(ids.ativo)
    }
  })

  test('dois cadastros ATIVOS com o mesmo CNPJ → pede a escolha; escolhido, usa o escolhido', async () => {
    const outro = await dbInsert<{ id: string }>('erp_clientes', { company_id: DEMO_GE, nome_fantasia: `E2E FC outro ativo ${RUN}`, cpf_cnpj: CNPJ_FMT })
    ids.outroAtivo = outro.id
    const amb = await comoARota(CNPJ, null)
    expect(amb.tipo, 'não chuta entre dois ativos').toBe('ambiguo')
    if (amb.tipo === 'ambiguo') expect(amb.candidatos.map((c) => c.id).sort()).toEqual([ids.ativo, outro.id].sort())
    const escolhido = await comoARota(CNPJ, outro.id)
    expect(escolhido.tipo === 'cliente' && escolhido.cliente.id).toBe(outro.id)
    // o cliente da OS continua mandando mesmo com dois ativos
    const daOs = await comoARota(CNPJ, ids.ativo)
    expect(daOs.tipo === 'cliente' && daOs.cliente.id).toBe(ids.ativo)
  })
})
