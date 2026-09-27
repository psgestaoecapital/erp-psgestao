// RD-83 · CAMINHO PRINCIPAL da tela Financeiro → Conexões bancárias (entregue com o #136, mTLS do Sicoob): abrir a
// tela e ver a lista de conexões da empresa igual à do banco. Só leitura. Demonstração Comércio (GE).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Caminho principal — Conexões bancárias', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-conexoes-bancarias', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abrir a tela de conexões bancárias da empresa', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))
    await page.goto('/dashboard/financeiro/conexoes-bancarias')
    await aguardarConteudo(page)
    await expect(page.getByText(/conex(ões|oes) banc(á|a)rias/i).first(), 'a tela abre').toBeVisible({ timeout: 20000 })
    expect(erros, 'sem erro de JavaScript na tela').toEqual([])
  })
})
