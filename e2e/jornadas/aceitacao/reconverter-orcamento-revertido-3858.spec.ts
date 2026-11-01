// Aceitação do chamado #3858 (FCR · jordana-code): orçamento revertido de pedido não convertia de novo — o pedido
// 'revertido' guarda o número 'PED-' || orc.numero e a reconversão violava erp_pedidos_company_id_numero_key.
// Migration 20261021042020: a reconversão gera PED-<numero>-2 (-3, ...), leva os itens ATUAIS do orçamento e recusa,
// com mensagem simples, um 2º pedido ativo do mesmo orçamento. @pos-migration: veredito em PRODUÇÃO.
// Demonstração Comércio (GE). As RPCs são chamadas COMO O ROBÔ (mesmo caminho da tela). Dados de teste apagados no fim (só a DEMO).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, rpcComoRobo } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
// erp_orcamentos.numero e erp_pedidos.numero são varchar(20): 'PED-' + 'R58-xxxxxxxx' + '-2' cabe
const NUM = `R58-${Date.now().toString(36)}`

test.describe('Aceitação #3858 — converter, reverter, alterar e converter de novo', () => {
  let orc = ''
  const pedidos: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-3858-reconverter-orcamento', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    orc = (await dbInsert<{ id: string }>('erp_orcamentos', {
      company_id: DEMO_COMERCIO, numero: NUM, cliente_nome: 'Cliente Aceitação 3858', status: 'aprovado',
      subtotal: 100, total: 100,
    })).id
    await dbInsert('erp_orcamentos_itens', {
      company_id: DEMO_COMERCIO, orcamento_id: orc, ordem: 1, produto_nome: 'Item aceitação 3858 A',
      quantidade: 2, preco_unitario: 50, subtotal: 100,
    })
  })

  test.afterAll(async () => {
    for (const p of pedidos) {
      await dbDelete('erp_pedidos_itens', `pedido_id=eq.${p}`).catch(() => {})
      await dbDelete('erp_pedidos', `id=eq.${p}`).catch(() => {})
    }
    if (orc) {
      await dbDelete('erp_orcamento_historico', `orcamento_id=eq.${orc}`).catch(() => {})
      await dbDelete('erp_orcamentos_itens', `orcamento_id=eq.${orc}`).catch(() => {})
      await dbDelete('erp_orcamentos', `id=eq.${orc}`).catch(() => {})
    }
  })

  test('reconverter orçamento revertido gera PED-<n>-2 com os itens atuais e só 1 pedido ativo', { tag: '@pos-migration' }, async () => {
    // 1) converte
    const c1 = await rpcComoRobo<string>('fn_converter_orcamento_em_pedido', { p_orcamento_id: orc })
    expect(c1.status, `1ª conversão: ${c1.texto}`).toBe(200)
    pedidos.push(c1.corpo as string)
    const [p1] = await dbSelect<{ numero: string }>('erp_pedidos', `id=eq.${c1.corpo}&select=numero`)
    expect(p1.numero).toBe(`PED-${NUM}`)

    // 2) reverte para orçamento
    const r = await rpcComoRobo<{ ok: boolean; erro?: string }>('fn_pedido_reverter_para_orcamento', { p_pedido_id: c1.corpo })
    expect(r.corpo?.ok, `reverter: ${r.texto}`).toBe(true)

    // 3) altera o orçamento (novo item)
    await dbInsert('erp_orcamentos_itens', {
      company_id: DEMO_COMERCIO, orcamento_id: orc, ordem: 2, produto_nome: 'Item aceitação 3858 B',
      quantidade: 1, preco_unitario: 30, subtotal: 30,
    })

    // 4) converte de novo — antes: duplicate key em erp_pedidos_company_id_numero_key
    const c2 = await rpcComoRobo<string>('fn_converter_orcamento_em_pedido', { p_orcamento_id: orc })
    expect(c2.status, `reconversão: ${c2.texto}`).toBe(200)
    pedidos.push(c2.corpo as string)
    const [p2] = await dbSelect<{ numero: string; status: string; orcamento_origem_id: string }>('erp_pedidos', `id=eq.${c2.corpo}&select=numero,status,orcamento_origem_id`)
    expect(p2).toMatchObject({ numero: `PED-${NUM}-2`, status: 'aberto', orcamento_origem_id: orc })
    const itens = await dbSelect('erp_pedidos_itens', `pedido_id=eq.${c2.corpo}&select=id`)
    expect(itens, 'o pedido novo leva os itens atuais do orçamento').toHaveLength(2)

    // 5) nunca 2 pedidos ativos do mesmo orçamento
    const ativos = await dbSelect('erp_pedidos', `orcamento_origem_id=eq.${orc}&status=not.in.(revertido,cancelado)&select=id`)
    expect(ativos).toHaveLength(1)
    const [o] = await dbSelect<{ status: string; pedido_id: string }>('erp_orcamentos', `id=eq.${orc}&select=status,pedido_id`)
    expect(o).toMatchObject({ status: 'convertido', pedido_id: c2.corpo })

    // 6) com pedido ativo, nova conversão é recusada com mensagem simples (a tela mostra este texto no diálogo)
    await dbPatch('erp_orcamentos', `id=eq.${orc}`, { status: 'aprovado', pedido_id: null })
    const c3 = await rpcComoRobo<{ message?: string }>('fn_converter_orcamento_em_pedido', { p_orcamento_id: orc })
    expect(c3.status).not.toBe(200)
    expect(c3.texto).toContain('já tem o pedido')
    await dbPatch('erp_orcamentos', `id=eq.${orc}`, { status: 'convertido', pedido_id: c2.corpo })
  })
})
