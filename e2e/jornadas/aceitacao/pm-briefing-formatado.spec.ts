// P&M · briefing formatado (Pdois/Marciana, CEO 07/10). Na "Agência (P&M) - DEMO" (robô só em demonstração):
//   no "Novo briefing", o texto com negrito e lista aparece FORMATADO ("Ver formatado"); o briefing salvo ABRE de novo e
//   recebe mais texto; depois de "Virar job", o job mostra o briefing ligado, formatado e com o que foi acrescentado.
// Limpeza: o job de teste vai para a lixeira e o briefing de teste é removido (dado de teste da demo).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbDelete, dbPatch, registrarJornada } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const MARCA = `Teste briefing formatado ${Date.now()}`

test.describe('P&M — briefing formatado, editável e visível no job', () => {
  test.afterAll(async () => {
    await dbPatch('agency_jobs', `company_id=eq.${DEMO_PM}&titulo=eq.${encodeURIComponent(MARCA)}`, { excluido_em: new Date().toISOString() }).catch(() => {})
    await dbDelete('agency_briefings', `company_id=eq.${DEMO_PM}&titulo=eq.${encodeURIComponent(MARCA)}`).catch(() => {})
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-briefing-formatado', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('negrito e lista formatados, briefing reaberto e visível no job ligado', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/pm/briefings')
    await aguardarConteudo(page)
    await page.getByTestId('briefing-novo').click()
    const modal = page.getByTestId('briefing-modal')
    await modal.getByTestId('briefing-titulo').fill(MARCA)
    await modal.getByTestId('briefing-texto-texto').fill('**Entregáveis:** carrossel\n- capa\n- 3 cards\n[referência](https://exemplo.com.br)')
    await modal.getByTestId('briefing-texto-ver').click()
    const formatado = modal.getByTestId('briefing-texto-formatado')
    await expect(formatado.locator('strong')).toHaveText('Entregáveis:')
    await expect(formatado.locator('ul li')).toHaveCount(2)
    await expect(formatado.locator('a')).toHaveAttribute('href', 'https://exemplo.com.br')
    await modal.getByTestId('briefing-texto-ver').click()
    await modal.getByTestId('briefing-salvar').click()

    const item = page.getByTestId('briefing-item').filter({ hasText: MARCA })
    await expect(item).toBeVisible({ timeout: 15000 })
    page.once('dialog', (d) => void d.accept())
    await item.getByTestId('briefing-virar-job').click()
    await expect(page.getByTestId('briefing-toast')).toContainText('briefing completo', { timeout: 15000 })

    // reabre o briefing e desenvolve mais o texto
    await item.getByTestId('briefing-abrir').click()
    await expect(modal.getByTestId('briefing-texto-texto')).toHaveValue(/Entregáveis/)
    await modal.getByTestId('briefing-texto-texto').fill('**Entregáveis:** carrossel\n- capa\n- 3 cards\n- **legenda curta**')
    await modal.getByTestId('briefing-salvar').click()
    await expect(page.getByTestId('briefing-toast')).toContainText('Briefing salvo', { timeout: 15000 })

    // o job ligado mostra o briefing ATUAL formatado
    await page.goto('/dashboard/producao')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: 'Jobs (lista)' }).click()
    await page.locator('tr').filter({ hasText: MARCA }).getByRole('button', { name: 'Editar' }).click()
    const ligado = page.getByTestId('job-briefing-ligado-texto')
    await expect(ligado.locator('strong').filter({ hasText: 'legenda curta' })).toBeVisible({ timeout: 15000 })
    await expect(ligado.locator('ul li')).toHaveCount(3)
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-briefing-ligado.png', fullPage: false })
  })
})
