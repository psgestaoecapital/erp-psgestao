// RD-78 · Aceitação do chamado Alliance #114 ("deixar campos não obrigatórios. E está dando falha").
// C1) "4,5" em Impostos % → a prévia abre (antes: 22P02 → "Falha ao calcular a prévia.") → Confirmar grava 4,5
//     (antes: o salvar gravava NULO em silêncio);
// C2) "abc" → mensagem com o campo e NADA muda no banco;
// C3) o aviso separa obrigatório (vagas, margem) de opcional.
// Sempre na Demonstração Revenda; o valor original de impostos volta no afterAll e o fn_demo_reset no teardown.

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada, DEMO_REVENDA } from '../../support/api'

type Cfg = { impostos_venda_pct: number | null }
const lerImp = async () => (await dbSelect<Cfg>('veic_config', `company_id=eq.${DEMO_REVENDA}&select=impostos_venda_pct`))[0]?.impostos_venda_pct

test.describe('Aceitação #114 — configuração aceita formato BR e não obriga o opcional', () => {
  let original: number | null | undefined

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-config-114', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.beforeAll(async () => { original = await lerImp() })
  test.afterAll(async () => { await dbPatch('veic_config', `company_id=eq.${DEMO_REVENDA}`, { impostos_venda_pct: original ?? null }) })

  test('C1 · "4,5" em Impostos % passa pela prévia e grava 4,5', async ({ page }) => {
    await page.goto('/dashboard/revenda/config')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    const imp = page.locator('label', { hasText: /^Impostos %/ }).locator('input')
    await expect(imp).toBeVisible({ timeout: 20000 })
    await imp.fill('4,5')
    await page.getByRole('button', { name: /Ver efeito e salvar/ }).click()
    await page.getByRole('button', { name: /Confirmar e salvar/ }).click({ timeout: 15000 })
    await expect(page.getByText('Configuração salva.').first()).toBeVisible({ timeout: 15000 })
    await expect.poll(async () => Number(await lerImp()), { timeout: 15000 }).toBe(4.5)
  })

  test('C2 · "abc" mostra o campo e não grava nada', async ({ page }) => {
    await page.goto('/dashboard/revenda/config')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    const antes = await lerImp()
    const imp = page.locator('label', { hasText: /^Impostos %/ }).locator('input')
    await expect(imp).toBeVisible({ timeout: 20000 })
    await imp.fill('abc')
    await page.getByRole('button', { name: /Ver efeito e salvar/ }).click()
    await expect(page.getByText(/Valor inválido em "impostos \(%\)"/).first()).toBeVisible({ timeout: 15000 })
    expect(await lerImp()).toBe(antes)
  })

  test('C3 · aviso separa obrigatório de opcional', async ({ page }) => {
    await page.goto('/dashboard/revenda/config')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)
    // a demo tem vagas e margem → nada obrigatório faltando; o texto antigo "Falta configurar:" não existe mais
    await expect(page.getByText(/Ver efeito e salvar/)).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Falta configurar:')).toHaveCount(0)
    await expect(page.getByText(/Para o preço mínimo calcular, falta:/)).toHaveCount(0)
  })
})
