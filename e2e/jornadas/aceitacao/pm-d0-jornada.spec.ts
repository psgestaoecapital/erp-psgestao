// P&M · D0 da Pdois — jornada de telas na "Agência (P&M) - DEMO", no computador e no celular.
// Só abre as telas do caminho principal (cliente → fee → job → Pauta → aprovação → horas → Meu dia) e confere:
// a tela carrega, sem tela de erro e sem rolagem lateral no celular. Não grava nada.
// Meus Trabalhos e Painel de Jobs (#2040/#2044) entram como @pos-migration: só existem depois do merge.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'

const TELAS_D0 = [
  ['Contratos / fee', '/dashboard/pm/contratos'],
  ['Pauta', '/dashboard/pm/pauta'],
  ['Aprovação do cliente', '/dashboard/pm/aprovacao'],
  ['Apontamento de horas', '/dashboard/pm/apontamento-horas'],
  ['Meu dia', '/dashboard/pm/meu-dia'],
] as const

const TELAS_NOVAS = [
  ['Meus Trabalhos', '/dashboard/pm/meus-trabalhos'],
  ['Painel de Jobs', '/dashboard/pm/painel-jobs'],
] as const

async function percorrer(page: import('@playwright/test').Page, nome: string, url: string) {
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
  for (const [w, h, rotulo] of [[1440, 900, 'computador'], [390, 844, 'celular']] as const) {
    await page.setViewportSize({ width: w, height: h })
    const respostas: number[] = []
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) respostas.push(r.status()) })
    await page.goto(url)
    await aguardarConteudo(page)
    await expect(page.locator('main, body').first(), `${nome} (${rotulo}) carrega`).toBeVisible()
    await expect(page.getByText(/Application error|Algo deu errado|Unhandled Runtime Error/i), `${nome} (${rotulo}) sem tela de erro`).toHaveCount(0)
    expect(respostas, `${nome} (${rotulo}) sem erro 5xx nas chamadas`).toEqual([])
    if (w === 390) {
      const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(sobra, `${nome} no celular sem rolagem lateral`).toBeLessThanOrEqual(2)
    }
  }
}

test.describe('PM D0 — jornada de telas (DEMO)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-d0-jornada', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  for (const [nome, url] of TELAS_D0) {
    test(`D0 · ${nome} abre no computador e no celular`, async ({ page }) => { await percorrer(page, nome, url) })
  }
  for (const [nome, url] of TELAS_NOVAS) {
    test(`D0 · ${nome} abre no computador e no celular`, { tag: '@pos-migration' }, async ({ page }) => { await percorrer(page, nome, url) })
  }
})
