// HB2 — Propostas dentro do Hub (/dashboard/projetos/propostas): a rota não redireciona mais para /dashboard/orcamentos.
// Só leitura, Demonstração Comércio (GE): a tela mostra a lista (ou o vazio que ensina) sem sair do Hub.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
// Construtora DEMO: semente durável com DEMO-ORC-001 (2 serviços do catálogo, preço 39.716,00, custo 29.419,55 → 25,9%).
const CONSTRUTORA = 'b0700000-0000-4000-a000-000000000006'

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

  test('cada proposta mostra itens do catálogo e margem dos itens (HB0 F15)', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, CONSTRUTORA)
    await page.goto('/dashboard/projetos/propostas')
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-propostas')
    await expect(tela.getByRole('heading', { name: 'Propostas' })).toBeVisible({ timeout: 30000 })
    const linha = tela.locator('tr', { hasText: 'DEMO-ORC-001' })
    test.skip((await linha.count()) === 0, 'Construtora DEMO sem a proposta da semente')
    await expect(linha.getByTestId('hub-proposta-itens')).toContainText('2 item(ns) · do catálogo')
    await expect(linha.getByTestId('hub-proposta-margem')).toHaveText('25,9%')
    await expect(tela.getByTestId('hub-propostas-do-catalogo')).toContainText(/\d+ de \d+/)
  })

  // HBF-0.3: a semente grava BDI 35 (= preço custo × 1,35), não mais 20 contra o padrão 31,86% (migration 20261024160000)
  test('propostas da semente DEMO saem com BDI no padrão da empresa (HBF-0.3)', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, CONSTRUTORA)
    await page.goto('/dashboard/projetos/propostas')
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-propostas')
    await expect(tela.getByRole('heading', { name: 'Propostas' })).toBeVisible({ timeout: 30000 })
    const linhas = tela.locator('tr', { hasText: /DEMO-ORC-00[1-5]/ })
    test.skip((await linhas.count()) === 0, 'Construtora DEMO sem as propostas da semente')
    await expect(linhas.first().getByTestId('hub-proposta-bdi')).toContainText('35,0%', { timeout: 20000 })
    await expect(linhas.getByTestId('hub-proposta-bdi-abaixo')).toHaveCount(0)
  })
})
