// Hub — Resultado por obra e Cockpit da obra alcançáveis pelas abas/Painel (CEO 08/10): do Painel, em até 3 toques.
// Demonstração Comércio (GE). As abas não dependem da migration; a escolha da obra usa fn_obras_listar já em produção.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Hub — menu das telas novas', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-menu-resultado-cockpit', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('Painel mostra Novidades e as abas levam a Resultado e Cockpit', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos')
    await aguardarConteudo(page)
    await expect(page.getByTestId('novidades-hub')).toContainText('Resultado por obra', { timeout: 30000 })
    await expect(page.getByTestId('novidades-hub')).toContainText('Cockpit da obra')

    await page.getByRole('link', { name: 'Resultado por obra' }).first().click()
    await expect(page).toHaveURL(/\/obras\/resultado/)

    await page.getByRole('link', { name: 'Cockpit da obra' }).first().click()
    await expect(page).toHaveURL(/\/obras\/cockpit/)
    await expect(page.getByTestId('cockpit-escolher')).toBeVisible({ timeout: 30000 })
  })
})
