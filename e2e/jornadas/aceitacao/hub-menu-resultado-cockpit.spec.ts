// Hub — Resultado por obra e Cockpit da obra acessíveis pelas abas do Hub (RD-83: até 3 toques, sem digitar URL).
// Abas vêm do layout do Hub (não dependem da migration); a lista de obras da Demonstração Comércio (GE) é lida de fn_obras_listar.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Hub — menu das telas novas', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-menu-resultado-cockpit', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('do Painel do Hub chega em Resultado por obra e no Cockpit pelas abas', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos')
    await aguardarConteudo(page)
    await expect(page.getByTestId('novidades-hub')).toContainText('Resultado por obra', { timeout: 30000 })

    await page.getByRole('link', { name: 'Resultado por obra' }).first().click()
    await expect(page).toHaveURL(/\/dashboard\/projetos\/obras\/resultado/)

    await page.getByRole('link', { name: 'Cockpit da obra' }).first().click()
    await expect(page).toHaveURL(/\/dashboard\/projetos\/obras\/cockpit/)
    await expect(page.getByTestId('cockpit-escolher')).toBeVisible({ timeout: 30000 })
  })
})
