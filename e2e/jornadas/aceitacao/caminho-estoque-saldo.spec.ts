// RD-83 · CAMINHO PRINCIPAL da tela Estoque → Saldo (entregue com o #96): abrir, buscar um produto pelo nome e ver
// só as linhas dele, com o saldo igual ao do banco. Só leitura. Demonstração Comércio (GE).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Caminho principal — Estoque: consultar o saldo de um produto', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-estoque-saldo', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('buscar um produto mostra só as linhas dele', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/commerce/estoque')
    await aguardarConteudo(page)
    const primeira = page.getByTestId('saldo-row').first()
    await expect(primeira, 'a demo tem estoque').toBeVisible({ timeout: 20000 })
    const nome = ((await primeira.locator('td').first().locator('div').first().textContent()) ?? '').trim()
    expect(nome).not.toBe('')

    await page.getByTestId('saldo-filtro-produto').fill(nome)
    await expect.poll(async () => {
      const nomes = await page.getByTestId('saldo-row').evaluateAll((trs) => trs.map((tr) => tr.querySelector('td div')?.textContent ?? ''))
      return nomes.length > 0 && nomes.every((n) => n.toLowerCase().includes(nome.toLowerCase()))
    }, { timeout: 10000 }).toBe(true)
  })
})
