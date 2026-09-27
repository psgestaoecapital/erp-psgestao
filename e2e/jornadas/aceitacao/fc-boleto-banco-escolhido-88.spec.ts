// #88 (FC Pisos) · "Efetuei os cadastros de API do Sicredi e ao tentar gerar o boleto o sistema mostra erro."
// Causa provada: a FC tem DOIS bancos emitindo boleto (Sicoob, cadastrado em 15/09, e Sicredi, em 16/09) e a tela
// pegava "o primeiro" sem ordem — o boleto ia pelo Sicoob (cujo certificado dava "unsupported pkcs12"), não pelo
// Sicredi que ela configurou. Agora: com mais de um banco, a tela mostra "Emitir boleto pelo banco" com o
// configurado por último como padrão, e lembra a escolha. Só frontend: roda no preview.
// A demonstração BLOQUEIA gravar config bancária ("Operação real bloqueada: empresa de auditoria") — correto. Por
// isso a lista de bancos vem simulada NO NAVEGADOR (page.route na consulta da tela, já ordenada por updated_at desc
// como o banco devolve); nada é gravado. Demonstração Comércio (GE).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Contas a receber — escolher o banco do boleto (#88)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-boleto-banco-88', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('dois bancos: padrão é o configurado por último, dá para trocar e a escolha fica lembrada', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)

    // a consulta de bancos com boleto (listarProvidersBoleto) volta Sicredi (16/09) antes de Sicoob (15/09)
    await page.route(/\/rest\/v1\/erp_banco_provider_config\?.*cap_boleto=eq\.true/, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([
        { provider: 'sicredi', updated_at: '2026-09-16T12:00:00Z' },
        { provider: 'sicoob', updated_at: '2026-09-15T12:00:00Z' },
      ]),
    }))
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/financeiro/receber')
    await aguardarConteudo(page)

    const sel = page.getByTestId('boleto-banco')
    await expect(sel, 'com 2 bancos aparece a escolha').toBeVisible({ timeout: 20000 })
    await expect(sel).toHaveValue('sicredi')   // configurado por último (como o Sicredi da FC)
    await expect(sel.locator('option')).toHaveText(['Sicredi', 'Sicoob'])

    await sel.selectOption('sicoob')
    await page.reload()
    await aguardarConteudo(page)
    await expect(page.getByTestId('boleto-banco'), 'a escolha fica lembrada').toHaveValue('sicoob', { timeout: 20000 })
  })
})
