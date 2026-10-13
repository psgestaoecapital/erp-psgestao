// RD-83 · CAMINHO PRINCIPAL da ficha do funcionário (Compliance), entregue com o #47. Abrir a ficha, alterar um
// campo dos Dados, salvar e conferir no banco; abrir a aba Documentos e ver a lista. Sem migration: roda no preview.
// Demonstração Indústria (SST); reset da demo no fim.

import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

const campo = (page: Page, rotulo: string) =>
  page.locator(`xpath=//label[normalize-space(.)="${rotulo}"]/following-sibling::*[self::input or self::textarea][1]`).first()

test.describe('Caminho principal — ficha do funcionário', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-compliance-funcionario', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { await rpc('fn_demo_reset', { p_company_id: DEMO_SST }) })

  test('abrir a ficha, salvar uma alteração nos Dados e ver os documentos', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [func] = await dbSelect<{ id: string }>('compliance_funcionarios',
      `company_id=eq.${DEMO_SST}&ativo=eq.true&select=id&order=nome_completo&limit=1`)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto(`/dashboard/compliance/funcionarios/${func.id}`)
    await aguardarConteudo(page)

    const obs = `caminho ficha ${RUN}`
    await campo(page, 'Observações').fill(obs)
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByText('Salvo com sucesso')).toBeVisible({ timeout: 20000 })
    await expect.poll(async () => (await dbSelect<{ observacoes: string | null }>('compliance_funcionarios', `id=eq.${func.id}&select=observacoes`))[0]?.observacoes,
      { timeout: 15000 }).toBe(obs)

    await page.getByRole('button', { name: /^Documentos \(/ }).click()
    await expect(page.getByTestId('doc-linha').first(), 'a aba Documentos lista os documentos da pessoa').toBeVisible({ timeout: 20000 })
  })
})
