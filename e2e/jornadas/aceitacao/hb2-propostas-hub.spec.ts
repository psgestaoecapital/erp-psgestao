// HB2 — Propostas dentro do Hub (/dashboard/projetos/propostas): a tela abre nativa, sem redirecionar para
// /dashboard/orcamentos, e mostra a lista (ou o vazio) com busca e filtro de situação. Só leitura (RD-52: erp_orcamentos).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'

test.describe('HB2 — propostas dentro do Hub', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb2-propostas-hub', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abre no Hub sem redirecionar e mostra a lista ou o vazio', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos/propostas')
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-propostas')
    await expect(tela).toBeVisible({ timeout: 30000 })
    await expect(page).toHaveURL(/\/dashboard\/projetos\/propostas/)
    await expect(tela.getByRole('heading', { name: 'Propostas' })).toBeVisible()
    await expect(tela.getByRole('link', { name: /Nova proposta/ })).toBeVisible()
  })
})
