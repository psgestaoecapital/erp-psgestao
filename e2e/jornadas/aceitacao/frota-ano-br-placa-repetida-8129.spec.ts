// RD-78 · Aceitação do chamado #8129 (Frioeste, Marcia Alba): cadastrar veículo quebrava com erro FALSO de
// "endereço incompleto" (o 22P02 do ano "2022/2022" caía no mapeamento de UUID do erroAmigavel — RD-74), e a
// placa repetida só dizia "já existe um registro" sem dizer o que fazer.
//   C1 (RD-83, caminho principal) · "2022/2022" no Ano cadastra e guarda o ano MODELO (2022), com "Salvo.".
//   C2 · placa repetida avisa QUAL placa e oferece abrir o veículo já cadastrado.
// Só na empresa de demonstração da Construtora (RD-69); placa única por execução e limpeza no afterAll.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000006' // Construtora Modelo - DEMO
const PLACA = `TST${Date.now().toString().slice(-5)}` // ex.: TST48213 — alfanumérica, ≥6, não colide com a demo

const selecionarDemo = (page: import('@playwright/test').Page) =>
  page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)

test.describe.serial('Aceitação #8129 — Frota: ano no padrão BR e placa repetida com caminho de saída', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-frota-8129', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { await dbDelete('erp_hub_frota_veiculo', `company_id=eq.${DEMO}&placa=eq.${PLACA}`) })

  test('C1 · "2022/2022" cadastra e guarda o ano modelo 2022 (sem erro falso de endereço)', async ({ page }) => {
    await selecionarDemo(page)
    await page.goto('/dashboard/projetos/frota')
    await aguardarConteudo(page)

    await page.getByTestId('frota-novo-veiculo').click()
    await page.getByLabel('Placa', { exact: true }).fill(PLACA)
    await page.getByLabel('Ano', { exact: true }).fill('2022/2022')
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()

    await expect(page.getByText('Salvo.').first()).toBeVisible({ timeout: 20000 })
    // a tela nunca mostrou a frase falsa "endereço desta página está incompleto"
    await expect(page.getByText(/endereço desta página está incompleto/i)).toHaveCount(0)
    // guardou o ano MODELO (o 2º), não texto cru
    await expect
      .poll(async () => (await dbSelect<{ ano: number | null }>('erp_hub_frota_veiculo',
        `company_id=eq.${DEMO}&placa=eq.${PLACA}&select=ano`))[0]?.ano, { timeout: 15000 })
      .toBe(2022)
  })

  test('C2 · placa repetida diz QUAL placa e oferece abrir o veículo já cadastrado', async ({ page }) => {
    await selecionarDemo(page)
    await page.goto('/dashboard/projetos/frota')
    await aguardarConteudo(page)

    await page.getByTestId('frota-novo-veiculo').click()
    await page.getByLabel('Placa', { exact: true }).fill(PLACA) // mesma placa do C1
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()

    await expect(page.getByRole('alert')).toContainText(`${PLACA} já está cadastrada`, { timeout: 20000 })
    await expect(page.getByRole('button', { name: /Abrir o veículo já cadastrado/ })).toBeVisible()
  })
})
