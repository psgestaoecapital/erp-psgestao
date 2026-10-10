// P&M · Papel na agência (@pos-migration): na "Agência (P&M) - DEMO", como o robô, a tela lista as pessoas, escolher
// um papel mostra o ANTES/DEPOIS e CANCELAR não grava nada. Computador e celular. (Aplicar fica para o CEO, em produção.)
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'

test.describe('PM — Papel na agência', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-papel-agencia', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  for (const vp of [{ n: 'computador', w: 1440, h: 900 }, { n: 'celular', w: 390, h: 844 }]) {
    test(`antes/depois sem gravar — ${vp.n}`, { tag: '@pos-migration' }, async ({ page }) => {
      await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
      await page.setViewportSize({ width: vp.w, height: vp.h })
      await page.goto('/dashboard/pm/equipe/papel')
      await aguardarConteudo(page)
      await expect(page.getByTestId('papel-agencia-page')).toBeVisible({ timeout: 20000 })
      await expect(page.getByTestId('papel-pessoa').first()).toBeVisible({ timeout: 20000 })
      await page.getByTestId('papel-select').first().selectOption('pm_producao')
      await expect(page.getByTestId('papel-antes-depois')).toContainText('Produção', { timeout: 15000 })
      await page.screenshot({ path: `e2e/diagnostico-host/pm-papel-agencia-${vp.n}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Cancelar' }).click()
      await expect(page.getByTestId('papel-antes-depois')).toHaveCount(0)
    })
  }
})
