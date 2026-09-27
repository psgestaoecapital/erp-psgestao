// RD-83 · CAMINHO PRINCIPAL da tela Oficina → Orçamento & Aprovação, entregue com o #132 (preço × quantidade).
// Abrir a tela, escolher a OS da demonstração, ver os itens e o total, registrar a aprovação e conferir no banco.
// Não depende da migration do #132 (confere só que a aprovação foi gravada). Demonstração Oficina (OS BOT-APROV).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'

test.describe('Caminho principal — Oficina, Orçamento & Aprovação', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-oficina-aprovacao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('escolher a OS, conferir itens e total, registrar a aprovação', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [os] = await dbSelect<{ id: string }>('erp_os', `company_id=eq.${DEMO_OFICINA}&numero=eq.BOT-APROV&select=id`)
    expect(os, 'a demo tem a OS BOT-APROV').toBeTruthy()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/aprovacao')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: /Qual laudo orçar/ })).toBeVisible({ timeout: 20000 })
    await page.getByText('BOT-APROV').first().click()
    await expect(page.getByText(/Itens do orçamento/)).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('aprov-total')).toBeVisible()

    const antes = new Date().toISOString()
    await page.getByPlaceholder('Nome do cliente').fill('Cliente caminho aprovação')
    await page.getByRole('button', { name: /Registrar aprovação/ }).click()
    await expect(page.getByText(/Orçamento registrado/)).toBeVisible({ timeout: 20000 })
    await expect.poll(async () => (await dbSelect('erp_os_aprovacao', `os_id=eq.${os.id}&created_at=gte.${encodeURIComponent(antes)}&select=id`)).length,
      { timeout: 20000 }).toBeGreaterThan(0)
  })
})
