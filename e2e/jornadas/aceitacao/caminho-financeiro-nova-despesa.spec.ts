// RD-83 · CAMINHO PRINCIPAL da tela Financeiro → Nova despesa, entregue com o #43 (fornecedor digitado vira
// cadastro). Abrir a tela, escolher um fornecedor JÁ cadastrado, valor e descrição, salvar e conferir no banco.
// Não depende de migration nova (fornecedor escolhido da lista não chama a RPC do #43): roda no preview da PR.
// Demonstração Comércio (GE), nunca empresa real. Despesa de teste excluída (soft) no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const DESCRICAO = `Caminho nova despesa ${RUN}`

test.describe('Caminho principal — Nova despesa com fornecedor da lista', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-financeiro-nova-despesa', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    await dbPatch('erp_pagar', `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESCRICAO)}`, { deleted_at: new Date().toISOString() })
  })

  test('escolher fornecedor, informar valor e salvar → despesa gravada e vinculada', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)
    const [forn] = await dbSelect<{ id: string; nome_fantasia: string }>('erp_fornecedores',
      `company_id=eq.${DEMO_COMERCIO}&ativo=eq.true&nome_fantasia=eq.${encodeURIComponent('Fornecedor Demo 1')}&select=id,nome_fantasia`)
    expect(forn, 'a demonstração tem o "Fornecedor Demo 1"').toBeTruthy()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/financeiro/nova-despesa')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: 'Nova despesa' })).toBeVisible({ timeout: 20000 })

    await page.getByTestId('despesa-fornecedor-select').selectOption(forn.id)
    await page.getByTestId('despesa-valor').fill('250')
    await page.getByPlaceholder('ex: "Aluguel sala maio" · vazio = geramos automático').fill(DESCRICAO)
    await page.getByRole('button', { name: 'Salvar despesa' }).click()

    await expect.poll(async () => (await dbSelect<{ fornecedor_id: string | null; valor: number; status: string }>('erp_pagar',
      `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESCRICAO)}&deleted_at=is.null&select=fornecedor_id,valor,status`))[0],
      { timeout: 20000 }).toMatchObject({ fornecedor_id: forn.id, status: 'aberto' })
    const [d] = await dbSelect<{ valor: number }>('erp_pagar', `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESCRICAO)}&select=valor`)
    expect(Number(d.valor)).toBe(250)
    await expect(page).toHaveURL(/\/dashboard\/financeiro\/pagar/, { timeout: 20000 })
  })
})
