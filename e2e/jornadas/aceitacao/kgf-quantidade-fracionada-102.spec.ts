// #102 (Gean) · "Precisamos poder colocar quantidade fracionada — óleo pode ir 1,5 litros — e o sistema só permite
// inteiros." Causa: a tela aceitava "1,5", mas mandava o texto com VÍRGULA e o banco (::numeric) recusava; só "1.5"
// passava (os 21 itens fracionados da Gean foram digitados com ponto). Agora a tela converte "1,5" → 1.5 ao salvar.
// Só frontend: roda no preview. Demonstração Oficina (OS BOT-DIAG); o item de teste é removido no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, registrarJornada } from '../../support/api'
import { decimalBanco } from '../../../src/lib/decimalBanco'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const DESC = `Óleo 102 ${RUN}`

test.describe('Diagnóstico — quantidade com vírgula (#102)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-qtd-fracionada-102', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    await dbDelete('erp_os_diagnostico_item', `company_id=eq.${DEMO_OFICINA}&descricao=eq.${encodeURIComponent(DESC)}`).catch(() => {})
  })

  test('regra: "1,5" → "1.5" · "1.234,5" → "1234.5" · "2" → "2"', () => {
    expect(decimalBanco('1,5')).toBe('1.5')
    expect(decimalBanco('1.234,5')).toBe('1234.5')
    expect(decimalBanco('2')).toBe('2')
    expect(decimalBanco('4.5')).toBe('4.5')
    expect(decimalBanco('')).toBe('')
  })

  test('digitar 1,5 na quantidade e salvar o laudo grava 1.5 no banco', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [os] = await dbSelect<{ id: string }>('erp_os', `company_id=eq.${DEMO_OFICINA}&numero=eq.BOT-DIAG&select=id`)
    expect(os, 'a demo tem a OS BOT-DIAG').toBeTruthy()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/diagnostico')
    await aguardarConteudo(page)
    await page.getByText('BOT-DIAG').first().click()
    await page.getByRole('button', { name: /Digitar (serviço|peça) livre/ }).click()
    await page.getByPlaceholder(/Qual (serviço|peça)\?/).last().fill(DESC)
    await page.getByTestId('diag-item-qtd').last().fill('1,5')
    await page.getByRole('button', { name: 'Salvar laudo' }).click()

    await expect.poll(async () => (await dbSelect<{ quantidade: number }>('erp_os_diagnostico_item',
      `os_id=eq.${os.id}&descricao=eq.${encodeURIComponent(DESC)}&select=quantidade`))[0]?.quantidade, { timeout: 20000 }).toBeTruthy()
    const [it] = await dbSelect<{ quantidade: number }>('erp_os_diagnostico_item', `os_id=eq.${os.id}&descricao=eq.${encodeURIComponent(DESC)}&select=quantidade`)
    expect(Number(it.quantidade), '1,5 digitado → 1.5 gravado').toBe(1.5)
  })
})
