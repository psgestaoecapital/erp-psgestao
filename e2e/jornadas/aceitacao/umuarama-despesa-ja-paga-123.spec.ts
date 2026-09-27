// #123 (Estância Umuarama) · "Na opção de lançamento de despesas assinalo que já está pago, porém o sistema não
// entende e deixa ela como em aberto ou vencido." Causa: o select de conta guarda o NOME ("CAIXA") e o form mandava
// esse nome em p_conta_bancaria_id (uuid) → a RPC falhava no cast, o erro era ignorado e a despesa ficava em aberto.
// Sem conta escolhida, o "já paguei" era ignorado em silêncio. Agora: manda o id da conta, confere o retorno e trava
// o "já paguei" sem conta. Só front — roda no preview da PR. Demonstração Comércio (GE), nunca empresa real.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const CONTA_CAIXA = 'DEMO-GE Caixa'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const DESC_PAGA = `Despesa 123 paga ${RUN}`
const DESC_SEM_CONTA = `Despesa 123 sem conta ${RUN}`

async function fornecedorDemo(): Promise<string> {
  const [f] = await dbSelect<{ id: string }>('erp_fornecedores',
    `company_id=eq.${DEMO_COMERCIO}&ativo=eq.true&nome_fantasia=eq.${encodeURIComponent('Fornecedor Demo 1')}&select=id`)
  expect(f, 'a demonstração tem o "Fornecedor Demo 1"').toBeTruthy()
  return f.id
}

test.describe('Nova despesa — "já paguei" grava paga (#123)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-despesa-ja-paga-123', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const d of [DESC_PAGA, DESC_SEM_CONTA]) {
      await dbPatch('erp_pagar', `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(d)}`, { deleted_at: new Date().toISOString() })
    }
  })

  test.beforeEach(async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/financeiro/nova-despesa')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: 'Nova despesa' })).toBeVisible({ timeout: 20000 })
  })

  test('marcar "já paguei" com a conta Caixa → a despesa nasce PAGA', async ({ page }) => {
    await page.getByTestId('despesa-fornecedor-select').selectOption(await fornecedorDemo())
    await page.getByTestId('despesa-valor').fill('181.81')
    await page.getByPlaceholder('ex: "Aluguel sala maio" · vazio = geramos automático').fill(DESC_PAGA)
    await page.getByTestId('despesa-conta').selectOption(CONTA_CAIXA) // o value do select é o NOME da conta
    await page.getByTestId('despesa-ja-paguei').check()
    await page.getByRole('button', { name: 'Salvar despesa' }).click()

    await expect.poll(async () => (await dbSelect<{ status: string; valor_pago: number | null; origem_baixa: string | null }>('erp_pagar',
      `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESC_PAGA)}&deleted_at=is.null&select=status,valor_pago,origem_baixa`))[0],
      { timeout: 20000 }).toMatchObject({ status: 'pago', origem_baixa: 'manual' })
    const [d] = await dbSelect<{ valor_pago: number }>('erp_pagar', `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESC_PAGA)}&select=valor_pago`)
    expect(Number(d.valor_pago), 'baixa pelo valor cheio').toBe(181.81)
    await expect(page).toHaveURL(/\/dashboard\/financeiro\/pagar/, { timeout: 20000 })
  })

  test('marcar "já paguei" SEM conta → avisa e não cria nada em aberto', async ({ page }) => {
    await page.getByTestId('despesa-fornecedor-select').selectOption(await fornecedorDemo())
    await page.getByTestId('despesa-valor').fill('99.90')
    await page.getByPlaceholder('ex: "Aluguel sala maio" · vazio = geramos automático').fill(DESC_SEM_CONTA)
    await page.getByTestId('despesa-conta').selectOption('')
    await page.getByTestId('despesa-ja-paguei').check()
    await page.getByRole('button', { name: 'Salvar despesa' }).click()

    await expect(page.getByText('escolha em qual conta saiu o dinheiro').first()).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(1500)
    expect((await dbSelect('erp_pagar', `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESC_SEM_CONTA)}&select=id`)).length,
      'nada gravado em aberto').toBe(0)
  })
})
