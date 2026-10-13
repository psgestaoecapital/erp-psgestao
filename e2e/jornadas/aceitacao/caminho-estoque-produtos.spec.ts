// RD-83 · CAMINHO PRINCIPAL da tela Estoque → aba Produtos, entregue com o #126 (lista além de 1000 itens).
// Abrir a tela, ir em Produtos, conferir a contagem com o banco e achar um produto da demonstração pela busca.
// Só leitura. Demonstração Comércio (GE), nunca empresa real.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Caminho principal — Estoque, aba Produtos', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-estoque-produtos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abrir Produtos, contagem bate com o banco e a busca acha o produto', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)
    const [prod] = await dbSelect<{ nome: string; codigo: string }>('erp_produtos',
      `company_id=eq.${DEMO_COMERCIO}&ativo=eq.true&codigo=not.like.T126-*&select=nome,codigo&order=nome&limit=1`)
    expect(prod, 'a demonstração tem produto ativo').toBeTruthy()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/commerce/estoque')
    await aguardarConteudo(page)

    await page.getByRole('button', { name: /^Produtos/ }).click()
    const ativos = (await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&ativo=eq.true&select=id&limit=1000`)).length
    if (ativos < 1000) await expect(page.getByTestId('estoque-tab-produtos-count')).toHaveText(String(ativos), { timeout: 30000 })

    await page.getByTestId('produtos-busca').fill(prod.codigo)
    await expect(page.getByTestId('produtos-contador')).toContainText('resultado', { timeout: 20000 })
    await expect(page.getByRole('cell', { name: prod.nome }).first()).toBeVisible({ timeout: 20000 })
  })
})
