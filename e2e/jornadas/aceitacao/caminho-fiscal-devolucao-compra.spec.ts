// RD-83 · CAMINHO PRINCIPAL da tela Fiscal → Devolução de compra, entregue com o #94/#142. A partir de uma NF-e
// recebida, a tela abre com o fornecedor (destinatário) e a chave de origem já preenchidos — conferidos contra o
// banco — e o botão de emitir fica disponível quando há itens. Nenhuma nota é emitida (fixture bloqueia /api/fiscal).
// Sem migration: roda no preview. Demonstração Comércio (GE).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Caminho principal — devolução de compra a partir da nota recebida', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-fiscal-devolucao-compra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abrir pela nota recebida → fornecedor e chave preenchidos', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [rec] = await dbSelect<{ id: string; chave_acesso: string; fornecedor_id: string }>('erp_nfe_recebidas',
      `company_id=eq.${DEMO_COMERCIO}&chave_acesso=not.is.null&fornecedor_id=not.is.null&select=id,chave_acesso,fornecedor_id&limit=1`)
    expect(rec, 'a demonstração tem NF-e de compra com fornecedor').toBeTruthy()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto(`/dashboard/fiscal/nfe/devolucao?recebida_id=${rec.id}`)
    await aguardarConteudo(page)

    await expect(page.getByTestId('nfe-devol-fornecedor'), 'fornecedor da nota já escolhido').toHaveValue(rec.fornecedor_id, { timeout: 20000 })
    await expect.poll(async () => (await page.getByTestId('nfe-devol-chave').inputValue()).replace(/\D/g, ''),
      { timeout: 20000 }).toBe(rec.chave_acesso)
    await expect(page.getByTestId('nfe-devol-emitir')).toBeVisible()
  })
})
