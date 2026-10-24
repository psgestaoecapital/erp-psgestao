// HB0 (auditor F20) — Take-off (/dashboard/projetos/takeoff): a tela mostra as 6 etapas do fluxo e a lista das plantas
// enviadas; abrir uma planta carrega os ambientes, os contadores e a etapa certa. Só leitura, DEMO Construtora.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000006'

test.describe('HB0 — Take-off com etapas', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb0-takeoff-etapas', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('mostra as 6 etapas e reabre uma planta enviada com os contadores', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos/takeoff')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: 'Takeoff por IA da planta' })).toBeVisible({ timeout: 30000 })
    const etapas = page.getByTestId('takeoff-etapas')
    await expect(etapas.getByTestId('takeoff-etapa')).toHaveCount(6)
    await expect(etapas).toContainText('Etapa 1 de 6: Enviar a planta')

    const lista = page.getByTestId('takeoff-plantas-recentes')
    await expect(lista).toBeVisible()
    const plantas = lista.getByTestId('takeoff-planta-recente')
    await expect(plantas.first().or(lista.getByText('Nenhuma planta enviada ainda'))).toBeVisible({ timeout: 30000 })
    test.skip((await plantas.count()) === 0, 'empresa DEMO sem planta enviada')

    await plantas.first().click()
    await expect(page.getByTestId('takeoff-contadores')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('takeoff-contador-extraidos')).not.toContainText(/^\s*Ambientes\s*0\s*$/)
    await expect(etapas).not.toContainText('Etapa 1 de 6')

    // celular: a página não rola de lado (a tabela rola dentro do cartão)
    const largura = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(largura).toBeLessThanOrEqual(1)
  })
})
