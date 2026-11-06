// Caixa jordana-code 3352399e, item 3 (Gean · FC Pisos, Eng. Chefe 09/10): unificar cadastros de cliente com o mesmo
// CNPJ na empresa. fn_cliente_unificar_previa mostra o que vai mudar; fn_cliente_unificar move títulos (inclusive pago,
// sem mexer em valor/status) para o principal, inativa o duplicado (unificado_para) e grava a auditoria.
// Demonstração Comércio (GE), nunca empresa real. Cadastros e títulos de teste desativados/excluídos no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, rpcComoRobo, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
// 14 dígitos únicos por execução (o servidor só compara dígitos)
const DOC = `8${Date.now().toString().slice(-9)}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`
const DOC_FMT = `${DOC.slice(0, 2)}.${DOC.slice(2, 5)}.${DOC.slice(5, 8)}/${DOC.slice(8, 12)}-${DOC.slice(12)}`
const hoje = new Date().toISOString().slice(0, 10)

const clientes: string[] = []
const titulos: string[] = []
type Mov = { tabela: string; rotulo: string; qtd: number; ids?: string[] }

test.describe('Cliente: unificar cadastros com o mesmo CNPJ (caixa 3352399e, item 3)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-cliente-unificar-cnpj', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    for (const id of titulos) await dbPatch('erp_receber', `id=eq.${id}`, { deleted_at: new Date().toISOString() })
    for (const id of clientes) await dbPatch('erp_clientes', `id=eq.${id}`, { ativo: false })
  })

  test('prévia conta, unificação move os títulos, inativa o duplicado e audita; recusa documento diferente', { tag: '@pos-migration' }, async () => {
    const principal = (await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_COMERCIO, tipo_pessoa: 'PJ', ativo: true, cnpj_cpf: DOC, nome_fantasia: `Unificar principal ${RUN}`,
    })).id
    clientes.push(principal)
    // o caso da Gean: o duplicado com o CNPJ formatado, já inativo
    const duplicado = (await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_COMERCIO, tipo_pessoa: 'PJ', ativo: false, cpf_cnpj: DOC_FMT, nome_fantasia: `Unificar duplicado ${RUN}`,
    })).id
    clientes.push(duplicado)
    const outro = (await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_COMERCIO, tipo_pessoa: 'PJ', ativo: true, nome_fantasia: `Unificar outro doc ${RUN}`,
    })).id
    clientes.push(outro)

    for (const [i, pago] of [[1, false], [2, true]] as const) {
      const t = await dbInsert<{ id: string }>('erp_receber', {
        company_id: DEMO_COMERCIO, cliente_id: duplicado, cliente_nome: `Unificar duplicado ${RUN}`,
        descricao: `Aceitação unificar ${RUN} · ${i}`, valor: 100 * i, data_emissao: hoje, data_vencimento: hoje,
        forma_pagamento: 'pix', ...(pago ? { valor_pago: 200, data_pagamento: hoje, status: 'pago' } : { status: 'aberto' }),
      })
      titulos.push(t.id)
    }
    const antes = await dbSelect<{ id: string; valor: number; status: string }>('erp_receber', `id=in.(${titulos.join(',')})&select=id,valor,status&order=id`)

    const lista = await rpcComoRobo<{ documento: string; cadastros: { id: string }[] }[]>('fn_clientes_duplicados_listar', { p_company_id: DEMO_COMERCIO })
    expect(lista.status, lista.texto).toBe(200)
    const grupo = (lista.corpo ?? []).find((g) => g.documento === DOC)
    expect(grupo?.cadastros.map((c) => c.id).sort(), 'o par aparece como duplicado').toEqual([principal, duplicado].sort())

    const recusa = await rpcComoRobo('fn_cliente_unificar_previa', { p_principal: principal, p_duplicado: outro })
    expect(recusa.status, 'documento diferente é recusado').not.toBe(200)
    expect(recusa.texto).toMatch(/MESMO CNPJ\/CPF/)

    const previa = await rpcComoRobo<{ mover: Mov[] }>('fn_cliente_unificar_previa', { p_principal: principal, p_duplicado: duplicado })
    expect(previa.status, previa.texto).toBe(200)
    expect(previa.corpo?.mover.find((m) => m.tabela === 'erp_receber')?.qtd).toBe(2)

    const feito = await rpcComoRobo<{ ok: boolean; unificacao_id: string; movidos: Mov[] }>('fn_cliente_unificar',
      { p_principal: principal, p_duplicado: duplicado, p_motivo: `aceitação ${RUN}` })
    expect(feito.status, feito.texto).toBe(200)
    expect(feito.corpo?.movidos.find((m) => m.tabela === 'erp_receber')?.qtd).toBe(2)
    expect([...(feito.corpo?.movidos.find((m) => m.tabela === 'erp_receber')?.ids ?? [])].sort(),
      'a auditoria guarda os ids movidos (para desfazer)').toEqual([...titulos].sort())

    const depois = await dbSelect<{ id: string; valor: number; status: string; cliente_id: string }>('erp_receber', `id=in.(${titulos.join(',')})&select=id,valor,status,cliente_id&order=id`)
    expect(depois.every((t) => t.cliente_id === principal), 'os títulos (aberto e pago) passam para o principal').toBe(true)
    expect(depois.map(({ id, valor, status }) => ({ id, valor, status })), 'valor e status não mudam').toEqual(antes)

    const [dup] = await dbSelect<{ ativo: boolean; unificado_para: string }>('erp_clientes', `id=eq.${duplicado}&select=ativo,unificado_para`)
    expect(dup).toEqual({ ativo: false, unificado_para: principal })
    const [aud] = await dbSelect<{ principal_id: string; documento: string }>('erp_cliente_unificacao', `id=eq.${feito.corpo?.unificacao_id}&select=principal_id,documento`)
    expect(aud).toEqual({ principal_id: principal, documento: DOC })

    const deNovo = await rpcComoRobo('fn_cliente_unificar', { p_principal: principal, p_duplicado: duplicado })
    expect(deNovo.status, 'unificar duas vezes é recusado').not.toBe(200)
    expect(deNovo.texto).toMatch(/já foi unificado/)
  })
})
