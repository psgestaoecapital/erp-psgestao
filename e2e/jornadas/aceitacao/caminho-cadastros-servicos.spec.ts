// RD-83 · CAMINHO PRINCIPAL da tela Cadastros → Serviços, entregue com o #146 (aviso de regime divergente).
// Abrir a lista, "Novo Serviço", informar a descrição, salvar e conferir no banco; o serviço de teste é apagado.
// Demonstração Comércio (GE).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const DESC = `Serviço caminho ${RUN}`

test.describe('Caminho principal — Cadastros, Serviços', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-cadastros-servicos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    await dbDelete('erp_servicos', `company_id=eq.${DEMO_COMERCIO}&descricao_resumida=eq.${encodeURIComponent(DESC)}`).catch(() => {})
  })

  test('Novo Serviço → descrição → Salvar → gravado no banco', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/cadastros/servicos')
    await aguardarConteudo(page)
    await page.getByTestId('servico-novo').click()
    await page.getByPlaceholder('ex: Hora técnica de mecânica').fill(DESC)
    await page.getByTestId('servico-salvar').click()
    await expect.poll(async () => (await dbSelect('erp_servicos', `company_id=eq.${DEMO_COMERCIO}&descricao_resumida=eq.${encodeURIComponent(DESC)}&select=id`)).length,
      { timeout: 20000 }).toBe(1)
  })
})
