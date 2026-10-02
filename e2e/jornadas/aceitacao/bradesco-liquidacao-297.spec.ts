// #297 Bradesco na baixa automática (CEO 01/10; manual API Cobrança v1.6.3). O que o banco devolve (lista das 7h,
// consulta individual das 13h, lista de baixados) vira chamada às duas funções novas — este teste prova as duas no
// banco de produção, na Demonstração Comércio (GE), com boletos 237 de teste criados e removidos no fim:
//  - pago acima do valor → título pago, juros registrados; repetir não baixa duas vezes;
//  - baixado no banco sem pagamento (57 "conforme seu pedido") → boleto marcado, título continua em aberto.
// Depende da migration 20261002200000 → @pos-migration.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, rpc, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString().slice(-8)
const NN_PAGO = `91${RUN}1`
const NN_BAIXADO = `91${RUN}2`
const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)

test.describe('Bradesco — baixa automática (#297)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    for (const [nn, valor] of [[NN_PAGO, 100], [NN_BAIXADO, 80]] as const) {
      await dbInsert('erp_receber', { company_id: DEMO_GE, descricao: `Aceitação Bradesco ${nn}`, valor, data_vencimento: hoje,
        status: 'aberto', boleto_status: 'registrado', boleto_banco_codigo: '237', boleto_nosso_numero: nn })
    }
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-297-bradesco-liquidacao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const nn of [NN_PAGO, NN_BAIXADO]) {
      const linhas = await dbSelect<{ id: string }>('erp_receber', `company_id=eq.${DEMO_GE}&boleto_nosso_numero=eq.${nn}&select=id`).catch(() => [])
      for (const l of linhas) {
        await dbDelete('erp_receber_baixa', `receber_id=eq.${l.id}`).catch(() => {})
        await dbDelete('erp_receber', `id=eq.${l.id}`).catch(() => dbPatch('erp_receber', `id=eq.${l.id}`, { deleted_at: new Date().toISOString() }).catch(() => {}))
      }
    }
  })

  test('pago com juros → título pago e juros registrados; repetir não baixa de novo', { tag: '@pos-migration' }, async () => {
    const r = await rpc<{ sucesso: boolean; tipo_diferenca?: string }>('fn_boleto_liquidar_banco', { p_company_id: DEMO_GE, p_banco_codigo: '237',
      p_nosso_numero: NN_PAGO, p_data_pagamento: hoje, p_valor_pago: 102.35, p_provider_raw: { teste: true }, p_provider: 'bradesco' })
    expect(r.sucesso).toBe(true)
    expect(r.tipo_diferenca).toBe('juros')
    const [t] = await dbSelect<{ status: string; valor_pago: number; juros: number; boleto_status: string }>('erp_receber',
      `company_id=eq.${DEMO_GE}&boleto_nosso_numero=eq.${NN_PAGO}&select=status,valor_pago,juros,boleto_status`)
    expect(t.status).toBe('pago')
    expect(Number(t.valor_pago)).toBe(102.35)
    expect(Number(t.juros), 'diferença registrada como juros').toBe(2.35)
    expect(t.boleto_status).toBe('liquidado')
    const de_novo = await rpc<{ sucesso: boolean; ja_liquidado?: boolean }>('fn_boleto_liquidar_banco', { p_company_id: DEMO_GE, p_banco_codigo: '237',
      p_nosso_numero: NN_PAGO, p_data_pagamento: hoje, p_valor_pago: 102.35, p_provider_raw: {}, p_provider: 'bradesco' })
    expect(de_novo.ja_liquidado, 'a lista das 7h e a consulta das 13h podem trazer o mesmo boleto: baixa uma vez só').toBe(true)
  })

  test('baixado no banco sem pagamento → boleto marcado, título continua em aberto', { tag: '@pos-migration' }, async () => {
    const r = await rpc<{ sucesso: boolean }>('fn_boleto_marcar_baixado_banco', { p_company_id: DEMO_GE, p_banco_codigo: '237',
      p_nosso_numero: NN_BAIXADO, p_codigo: 57, p_descricao: 'CONFORME SEU PEDIDO', p_data: hoje, p_provider_raw: {} })
    expect(r.sucesso).toBe(true)
    const [t] = await dbSelect<{ status: string; valor_pago: number | null; boleto_status: string; boleto_baixa_banco_codigo: number }>('erp_receber',
      `company_id=eq.${DEMO_GE}&boleto_nosso_numero=eq.${NN_BAIXADO}&select=status,valor_pago,boleto_status,boleto_baixa_banco_codigo`)
    expect(t.boleto_status).toBe('baixado_banco')
    expect(t.boleto_baixa_banco_codigo).toBe(57)
    expect(t.status, 'o título NÃO é baixado como pago').toBe('aberto')
    expect(Number(t.valor_pago ?? 0)).toBe(0)
  })
})
