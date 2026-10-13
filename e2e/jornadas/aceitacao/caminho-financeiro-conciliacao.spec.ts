// RD-83 · CAMINHO PRINCIPAL da tela Financeiro → Conciliação bancária (inbox), entregue com o achado A.
// Abrir a conciliação, escolher o lote, ver as opções do crédito, conciliar com o título sugerido e conferir no banco
// (movimento 'conciliado', título 'pago' pelo valor). Não depende de migration nova (roda no preview da PR) e entra
// na varredura semanal em produção (testDir = e2e/jornadas). Demonstração Comércio (GE), nunca empresa real.
// Título excluído (soft) e extrato de teste apagado no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const hoje = new Date().toISOString().slice(0, 10)
const VALOR = 311.47
const CLIENTE = `Cliente Caminho Conc ${RUN}`

test.describe('Caminho principal — Conciliação: conciliar crédito com o título sugerido grava no banco', () => {
  let lote = ''
  let mov = ''
  let titulo = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-financeiro-conciliacao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)
    titulo = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, cliente_nome: CLIENTE, descricao: `Caminho conciliação ${RUN}`, valor: VALOR,
      data_emissao: hoje, data_vencimento: hoje, status: 'aberto', forma_pagamento: 'pix',
    })).id
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Caminho conciliação ${RUN}`,
    })).id
    mov = (await dbInsert<{ id: string }>('conciliacao_movimento', {
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: hoje, valor: VALOR, descricao: `PIX RECEBIDO CAMINHO ${RUN}`,
      natureza: 'credito', status: 'pendente',
    })).id
  })

  test.afterAll(async () => {
    if (lote) {
      await dbDelete('conciliacao_vinculo', `movimento_id=eq.${mov || '00000000-0000-0000-0000-000000000000'}`)
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`)
      await dbDelete('conciliacao_lote', `id=eq.${lote}`)
    }
    if (titulo) await dbPatch('erp_receber', `id=eq.${titulo}`, { deleted_at: new Date().toISOString() })
  })

  test('abrir a conciliação, ver opções do crédito e conciliar com o título → movimento conciliado e título pago', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/financeiro/conciliacao/inbox')
    await aguardarConteudo(page)

    // o lote de teste (o mais recente) é escolhido; garante pelo seletor
    const seletorLote = page.locator(`select:has(option[value="${lote}"])`)
    await expect(seletorLote).toBeVisible({ timeout: 20000 })
    await seletorLote.selectOption(lote)

    const cartao = page.locator('div', { hasText: `PIX RECEBIDO CAMINHO ${RUN}` }).filter({ has: page.getByTestId('conc-toggle-expand') }).last()
    await expect(cartao).toBeVisible({ timeout: 20000 })
    await cartao.getByTestId('conc-toggle-expand').click()

    const opcao = cartao.locator('div', { hasText: CLIENTE }).filter({ has: page.getByRole('button', { name: 'Conciliar', exact: true }) }).last()
    await expect(opcao, 'o título do cliente aparece entre as opções').toBeVisible({ timeout: 20000 })
    await opcao.getByRole('button', { name: 'Conciliar', exact: true }).click()

    await expect.poll(async () => (await dbSelect<{ status: string }>('conciliacao_movimento', `id=eq.${mov}&select=status`))[0]?.status,
      { timeout: 20000 }).toBe('conciliado')
    const [t] = await dbSelect<{ status: string; valor_pago: number }>('erp_receber', `id=eq.${titulo}&select=status,valor_pago`)
    expect(t.status).toBe('pago')
    expect(Number(t.valor_pago)).toBe(VALOR)
  })
})
