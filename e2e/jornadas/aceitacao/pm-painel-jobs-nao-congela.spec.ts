// Painel de Jobs (P&M) — mapeamento real da "Agência (P&M) - DEMO" em 10/10: o navegador congelava no uso.
// Causa provada: o botão "PDF" chamava window.print(); o diálogo de impressão é modal e para a aba inteira até ser
// fechado. Correção: PDF gerado como arquivo (pdf-lib, mesmo helper das listas), sem diálogo.
// Na demo, como o robô: abre a tela, clica Excel / PDF / Filtro e confere que a página continua respondendo,
// que o PDF baixa um arquivo .pdf de verdade e que window.print() nunca é chamado.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'

test.describe('P&M — Painel de Jobs não congela o navegador', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-painel-jobs-nao-congela', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abre, clica Excel / PDF / Filtro e a página segue respondendo', async ({ page }) => {
    await page.addInitScript((id) => {
      try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ }
      const w = window as unknown as { __impressoes: number; print: () => void }
      w.__impressoes = 0
      w.print = () => { w.__impressoes++ }
    }, DEMO_PM)
    await page.setViewportSize({ width: 1366, height: 860 })
    await page.goto('/dashboard/pm/painel-jobs')
    await aguardarConteudo(page)
    await expect(page.getByText('Total de jobs')).toBeVisible({ timeout: 30_000 })

    // a página responde em menos de 5 s (aba travada não devolve nada)
    const responde = async (passo: string) => {
      const r = await Promise.race([page.evaluate(() => 'ok'), new Promise<string>((ok) => setTimeout(() => ok('travada'), 5_000))])
      expect(r, `página responde depois de: ${passo}`).toBe('ok')
    }
    await responde('abrir')

    const excel = page.waitForEvent('download', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Excel' }).click()
    expect((await excel).suggestedFilename()).toMatch(/\.xlsx$/)
    await responde('Excel')

    for (const vez of [1, 2]) {
      const pdf = page.waitForEvent('download', { timeout: 20_000 })
      await page.getByTestId('painel-pdf').click()
      const d = await pdf
      expect(d.suggestedFilename(), `PDF (${vez}ª vez) é arquivo .pdf`).toMatch(/\.pdf$/)
      await responde(`PDF (${vez}ª vez)`)
    }
    expect(await page.evaluate(() => (window as unknown as { __impressoes: number }).__impressoes), 'PDF não abre o diálogo de impressão').toBe(0)

    await page.getByRole('button', { name: /^Filtro/ }).click()
    await expect(page.getByText('Minhas opções:')).toBeVisible()
    await responde('Filtro')
  })
})
