// Hub — Resultado por obra e Cockpit da obra alcançáveis pelas abas do Hub em até 3 toques (RD-83).
// Painel mostra "Novidades do Hub"; aba Cockpit lista as obras e abre o cockpit da escolhida.
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Hub — menu das telas novas', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-menu-resultado-cockpit', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('painel → Resultado por obra; aba → Cockpit da obra', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos')
    await aguardarConteudo(page)
    await expect(page.getByTestId('hub-novidades')).toContainText('Resultado por obra', { timeout: 30000 })
    await page.getByRole('link', { name: 'Resultado por obra' }).first().click()
    await expect(page).toHaveURL(/\/projetos\/obras\/resultado/)

    await page.getByRole('link', { name: 'Cockpit da obra' }).first().click()
    await expect(page).toHaveURL(/\/projetos\/obras\/cockpit/)
    await expect(page.getByTestId('cockpit-escolher-obra')).toBeVisible({ timeout: 30000 })
  })
})
