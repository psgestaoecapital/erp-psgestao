// HB0 (auditor_pdca_g 24/10) — no login, quando o POST ao Supabase cai (rede), a tela diz "sem conexão com o servidor",
// nunca "e-mail ou senha incorretos". Sem sessão; a rede do token é derrubada no próprio navegador. Não grava nada.

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('HB0 — login sem conexão', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb0-login-sem-conexao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('falha de rede no login mostra "sem conexão", não "senha incorreta"', async ({ page }) => {
    await page.goto('/')
    await page.route('**/auth/v1/token**', (r) => r.abort('internetdisconnected'))
    await page.locator('input[type="email"]').fill('ninguem@exemplo.com')
    await page.locator('input[type="password"]').fill('qualquer-senha')
    await page.locator('form button[type="submit"]').click()
    await expect(page.getByText(/Sem conexão com o servidor/)).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(/E-mail ou senha incorretos/)).toHaveCount(0)
  })
})
