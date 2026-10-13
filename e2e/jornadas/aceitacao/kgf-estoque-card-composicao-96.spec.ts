// #96 (Jordana · Gean) · "Na tela de consulta de estoque, ao clicar em um card o sistema mostre o que compõe o
// valor do card." Clicar no card leva a tabela para a composição daquele número: Valor do estoque → linhas do maior
// para o menor valor, com a soma igual ao card; Negativos/Zerados/Com saldo → só essas linhas. Só frontend.
// Demonstração Comércio (GE).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const num = (t: string | null) => Number(String(t ?? '').replace(/[^\d,-]/g, '').replace(',', '.'))

test.describe('Estoque — clicar no card mostra o que compõe o número (#96)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-estoque-card-96', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('card Valor: lista do maior para o menor e soma = card; card Com saldo: só linhas com saldo', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/commerce/estoque')
    await aguardarConteudo(page)
    await expect(page.getByTestId('saldo-row').first(), 'a demo tem estoque').toBeVisible({ timeout: 20000 })

    const cardValor = page.getByTestId('saldo-card-valor')
    const valorCard = num(await cardValor.locator('div').nth(1).textContent())
    await cardValor.click()
    await expect(page.getByTestId('saldo-composicao')).toContainText('Valor do estoque líquido')
    expect(num(await page.getByTestId('saldo-composicao-soma').textContent()), 'a soma da composição bate com o card').toBeCloseTo(valorCard, 2)
    const valores = await page.getByTestId('saldo-row').evaluateAll((trs) => trs.map((tr) => (tr.querySelectorAll('td')[6]?.textContent ?? '')))
    const nums = valores.map((v) => Number(v.replace(/[^\d,-]/g, '').replace(',', '.')) || 0)
    for (let i = 1; i < nums.length; i++) expect(nums[i - 1], 'do maior para o menor valor').toBeGreaterThanOrEqual(nums[i])

    const cardCom = page.getByTestId('saldo-card-com')
    const nCom = Number(await cardCom.locator('div').nth(1).textContent())
    await cardCom.click()
    await expect(page.getByTestId('saldo-composicao')).toContainText('Com saldo')
    await expect(page.getByTestId('saldo-row')).toHaveCount(nCom)
  })
})
