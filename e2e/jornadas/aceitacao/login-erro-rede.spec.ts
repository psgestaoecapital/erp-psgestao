// Auditor 24/10 (auditor_pdca_g) · o login dizia "E-mail ou senha incorretos" também quando o POST ao Supabase Auth
// caía por falha de rede. Confere, SEM sessão e sem credencial real (a chamada ao /auth/v1/token é interceptada):
// rede caída → "Sem conexão com o servidor"; senha recusada (400 invalid_credentials) → "E-mail ou senha incorretos".
// Não grava nada.

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

test.use({ storageState: { cookies: [], origins: [] } })

const TOKEN = /\/auth\/v1\/token/

async function tentarEntrar(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.locator('input[type="email"]').fill('ninguem@exemplo.com.br')
  await page.locator('input[type="password"]').first().fill('senha-qualquer')
  await page.getByRole('button', { name: 'Entrar' }).click()
}

test.describe('Login — falha de rede não vira "senha incorreta"', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-login-erro-rede', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('rede caída no POST de login mostra "sem conexão com o servidor"', async ({ page }) => {
    await page.route(TOKEN, (route) => route.abort('internetdisconnected'))
    await tentarEntrar(page)
    const aviso = page.getByTestId('login-erro')
    await expect(aviso).toContainText('Sem conexão com o servidor', { timeout: 15_000 })
    await expect(aviso).not.toContainText('incorretos')
  })

  test('credencial recusada continua mostrando "e-mail ou senha incorretos"', async ({ page }) => {
    await page.route(TOKEN, (route) => route.fulfill({
      status: 400, contentType: 'application/json',
      body: JSON.stringify({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }),
    }))
    await tentarEntrar(page)
    await expect(page.getByTestId('login-erro')).toContainText('E-mail ou senha incorretos', { timeout: 15_000 })
  })
})
