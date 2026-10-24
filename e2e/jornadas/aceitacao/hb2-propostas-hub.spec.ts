// HB2 — Propostas dentro do Hub (/dashboard/projetos/propostas): a rota não redireciona mais para /dashboard/orcamentos.
// Só leitura, Demonstração Comércio (GE): a tela mostra a lista (ou o vazio que ensina) sem sair do Hub.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'

test.describe('HB2 — Propostas no Hub', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb2-propostas-hub', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abre a lista nativa sem redirecionar para orçamentos', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos/propostas')
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-propostas')
    await expect(tela.getByRole('heading', { name: 'Propostas' })).toBeVisible({ timeout: 30000 })
    await expect(page).toHaveURL(/\/dashboard\/projetos\/propostas/)
    await expect(tela.getByRole('link', { name: /Nova proposta/ })).toBeVisible()
  })

  test('"Abrir" leva o id da proposta ao editor (HB0 item 4)', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos/propostas')
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-propostas')
    await expect(tela.getByRole('heading', { name: 'Propostas' })).toBeVisible({ timeout: 30000 })
    const abrir = tela.getByTestId('hub-proposta-abrir')
    test.skip((await abrir.count()) === 0, 'empresa DEMO sem proposta: nada para abrir')
    await expect(abrir.first()).toHaveAttribute('href', /\/dashboard\/orcamentos\?id=[0-9a-f-]{36}$/)
  })

  test('funil por situação filtra a lista e mostra os indicadores (HB0 F15)', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos/propostas')
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-propostas')
    await expect(tela.getByRole('heading', { name: 'Propostas' })).toBeVisible({ timeout: 30000 })
    const etapas = tela.getByTestId('hub-propostas-funil-etapa')
    test.skip((await etapas.count()) === 0, 'empresa DEMO sem proposta: funil vazio')
    await expect(tela.getByTestId('hub-propostas-taxa')).toBeVisible()
    await expect(tela.getByTestId('hub-propostas-a-vencer')).toBeVisible()
    const primeira = etapas.first()
    const n = Number((await primeira.innerText()).split('·')[1]?.trim())
    await primeira.click()
    await expect(primeira).toHaveAttribute('aria-pressed', 'true')
    await expect(tela.getByTestId('hub-proposta-abrir')).toHaveCount(n)
    await primeira.click()
    await expect(primeira).toHaveAttribute('aria-pressed', 'false')
  })
})
