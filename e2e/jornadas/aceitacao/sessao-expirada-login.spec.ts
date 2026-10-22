// P0 16/10 · sessão expirada: /login nunca foi tela (o login é a raiz "/"), mas guardas antigas redirecionavam para
// /login?returnTo=... e o usuário via 404. Confere, SEM sessão: /login encaminha para "/" preservando o returnTo, e as
// telas do dashboard sem sessão levam ao login (nunca 404) com a rota de origem em returnTo. Não grava nada.

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Sessão expirada — volta para o login, nunca 404', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-sessao-expirada-login', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('/login?returnTo=... encaminha para "/" com o returnTo e mostra o formulário de entrada', async ({ page }) => {
    const resp = await page.goto('/login?returnTo=%2Fdashboard%2Fhome')
    expect(resp?.status(), '/login não pode ser 404').toBeLessThan(400)
    await expect(page).toHaveURL(/\/\?returnTo=%2Fdashboard%2Fhome$/)
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  for (const rota of ['/dashboard/home', '/dashboard/dev']) {
    test(`sem sessão em ${rota} cai no login com returnTo da origem`, async ({ page }) => {
      await page.goto(rota)
      await expect(page).toHaveURL(new RegExp(`/\\?returnTo=${encodeURIComponent(rota).replace(/%/g, '%')}`), { timeout: 15_000 })
      await expect(page.locator('input[type="password"]')).toBeVisible()
    })
  }
})
