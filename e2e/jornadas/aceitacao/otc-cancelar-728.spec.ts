// #728 (R.R · CEO aprovou 01/10) · cancelar orçamento e pedido na tela Vender e Faturar.
// Caminho principal (pela tela): pedido aberto com 2 parcelas previstas → "Cancelar pedido" → motivo obrigatório →
// pedido e parcelas ficam "cancelado", com o motivo no histórico (nada é apagado — RD-30).
// Travas (do banco): pedido já faturado é recusado com o motivo; orçamento já convertido manda cancelar o pedido.
// Depende das funções da migration 20261002090000 → @pos-migration. Demonstração Comércio (GE); dados de teste
// criados e removidos no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, rpc, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36)
const CLI_ABERTO = `Cancelar aberto ${RUN}`
const CLI_FATURADO = `Cancelar faturado ${RUN}`
let pedAberto = ''
let pedFaturado = ''
let orcRascunho = ''

test.describe('Vender e Faturar — cancelar orçamento e pedido (#728)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    pedAberto = (await dbInsert<{ id: string }>('erp_pedidos', {
      company_id: DEMO_GE, numero: `CAN-${RUN}`, cliente_nome: CLI_ABERTO, status: 'aberto', subtotal: 300, total: 300,
    })).id
    for (const n of [1, 2]) {
      await dbInsert('erp_receber', {
        company_id: DEMO_GE, descricao: `Pedido CAN-${RUN} - parcela ${n}`, valor: 150,
        data_vencimento: new Date(Date.now() + n * 30 * 86400000).toISOString().slice(0, 10),
        status: 'previsto', pedido_id: pedAberto, cliente_nome: CLI_ABERTO,
      })
    }
    pedFaturado = (await dbInsert<{ id: string }>('erp_pedidos', {
      company_id: DEMO_GE, numero: `CANF-${RUN}`, cliente_nome: CLI_FATURADO, status: 'faturado', subtotal: 200, total: 200,
    })).id
    orcRascunho = (await dbInsert<{ id: string }>('erp_orcamentos', {
      company_id: DEMO_GE, numero: `ORC-CAN-${RUN}`, cliente_nome: `Cancelar orçamento ${RUN}`, status: 'rascunho', subtotal: 100, total: 100,
    })).id
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-728-otc-cancelar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const id of [pedAberto, pedFaturado].filter(Boolean)) {
      await dbDelete('erp_pedido_historico', `pedido_id=eq.${id}`).catch(() => {})
      await dbDelete('erp_receber', `pedido_id=eq.${id}`)
        .catch(() => dbPatch('erp_receber', `pedido_id=eq.${id}`, { deleted_at: new Date().toISOString() }).catch(() => {}))
      await dbDelete('erp_pedidos', `id=eq.${id}`).catch(() => {})
    }
    if (orcRascunho) {
      await dbDelete('erp_orcamento_historico', `orcamento_id=eq.${orcRascunho}`).catch(() => {})
      await dbDelete('erp_orcamentos', `id=eq.${orcRascunho}`).catch(() => {})
    }
  })

  test('caminho principal: cancelar pedido pela tela, com motivo → pedido e parcelas cancelados, motivo no histórico', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/commerce/otc')
    await aguardarConteudo(page)
    await page.getByText(CLI_ABERTO).first().click()
    await page.getByTestId('pedido-cancelar').click()
    const modal = page.getByTestId('cancelar-venda-modal')
    await expect(modal).toBeVisible()
    await expect(modal.getByTestId('cancelar-venda-confirmar'), 'sem motivo não cancela').toBeDisabled()
    await modal.getByTestId('cancelar-venda-texto').fill('Cliente desistiu do serviço (teste)')
    await modal.getByTestId('cancelar-venda-confirmar').click()
    await expect(modal).toBeHidden({ timeout: 15000 })

    await expect.poll(async () => (await dbSelect<{ status: string }>('erp_pedidos', `id=eq.${pedAberto}&select=status`))[0]?.status,
      { timeout: 15000 }).toBe('cancelado')
    const rec = await dbSelect<{ status: string; motivo_perda: string | null }>('erp_receber', `pedido_id=eq.${pedAberto}&select=status,motivo_perda`)
    expect(rec.length, 'as parcelas continuam lá (nada é apagado)').toBe(2)
    expect(rec.every((r) => r.status === 'cancelado' && (r.motivo_perda ?? '').includes('desistiu')), 'parcelas canceladas com o motivo').toBe(true)
    const [h] = await dbSelect<{ evento: string; detalhe: string }>('erp_pedido_historico', `pedido_id=eq.${pedAberto}&evento=eq.cancelado&select=evento,detalhe`)
    expect(h?.detalhe).toContain('desistiu')
  })

  test('pedido já faturado: a tela mostra o motivo da recusa e nada muda', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/commerce/otc')
    await aguardarConteudo(page)
    await page.getByText(CLI_FATURADO).first().click()
    await page.getByTestId('pedido-cancelar').click()
    const modal = page.getByTestId('cancelar-venda-modal')
    await modal.getByTestId('cancelar-venda-texto').fill('Tentativa de cancelar faturado (teste)')
    await modal.getByTestId('cancelar-venda-confirmar').click()
    await expect(modal.getByTestId('cancelar-venda-erro')).toContainText('já foi faturado', { timeout: 15000 })
    const [p] = await dbSelect<{ status: string }>('erp_pedidos', `id=eq.${pedFaturado}&select=status`)
    expect(p.status).toBe('faturado')
  })

  test('orçamento: cancela com motivo; já cancelado não cancela de novo', { tag: '@pos-migration' }, async () => {
    const r = await rpc<{ ok: boolean; status?: string }>('fn_orcamento_cancelar', { p_orcamento_id: orcRascunho, p_motivo_perda_id: null, p_motivo_texto: 'Cliente pediu para cancelar (teste)' })
    expect(r.ok).toBe(true)
    const [o] = await dbSelect<{ status: string }>('erp_orcamentos', `id=eq.${orcRascunho}&select=status`)
    expect(o.status).toBe('cancelado')
    const [h] = await dbSelect<{ detalhe: string }>('erp_orcamento_historico', `orcamento_id=eq.${orcRascunho}&evento=eq.cancelado&select=detalhe`)
    expect(h?.detalhe).toContain('cancelar')
    const r2 = await rpc<{ ok: boolean }>('fn_orcamento_cancelar', { p_orcamento_id: orcRascunho, p_motivo_perda_id: null, p_motivo_texto: 'de novo (teste)' })
    expect(r2.ok, 'já cancelado').toBe(false)
  })
})
