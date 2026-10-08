// Hub — as telas novas (Resultado por obra, Cockpit da obra) aparecem nas abas e no Painel, a no máximo 2 toques.
// Demonstração Comércio (GE). Menu do banco depende da migration 20261008170005 → @pos-migration; as abas e o Painel não.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Hub — menu com Resultado e Cockpit', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-menu-resultado-cockpit', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('do Painel do Hub: Novidades levam a Resultado por obra e ao Cockpit', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos')
    await aguardarConteudo(page)
    const novidades = page.getByTestId('hub-novidades')
    await expect(novidades).toContainText('Novidades do Hub', { timeout: 30000 })
    await novidades.getByRole('link', { name: /Cockpit da obra/ }).click()
    await expect(page.getByTestId('hub-cockpit-escolher')).toBeVisible({ timeout: 30000 })
    await page.getByRole('link', { name: 'Resultado', exact: true }).click()
    await expect(page).toHaveURL(/obras\/resultado/)
  })
})
