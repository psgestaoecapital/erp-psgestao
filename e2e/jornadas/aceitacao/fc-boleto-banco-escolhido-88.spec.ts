// #88 (FC Pisos) · "Efetuei os cadastros de API do Sicredi e ao tentar gerar o boleto o sistema mostra erro."
// Causa provada: a FC tem DOIS bancos emitindo boleto (Sicoob, cadastrado em 15/09, e Sicredi, em 16/09) e a tela
// pegava "o primeiro" sem ordem — o boleto ia pelo Sicoob (cujo certificado dava "unsupported pkcs12"), não pelo
// Sicredi que ela configurou. Agora: com mais de um banco, a tela mostra "Emitir boleto pelo banco" com o
// configurado por último como padrão, e lembra a escolha. Só frontend: roda no preview.
// Demonstração Comércio (GE): cria 2 configs de teste (sem credencial, homologação) e remove no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Contas a receber — escolher o banco do boleto (#88)', () => {
  const criados: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-boleto-banco-88', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    await dbDelete('erp_banco_provider_config', `company_id=eq.${DEMO_COMERCIO}&banco_codigo=in.(756,748)`)
    criados.push((await dbInsert<{ id: string }>('erp_banco_provider_config', {
      company_id: DEMO_COMERCIO, banco_codigo: '756', provider: 'sicoob', ambiente: 'homologacao', ativo: true, cap_boleto: true,
      updated_at: '2026-09-15T12:00:00Z',
    })).id)
    criados.push((await dbInsert<{ id: string }>('erp_banco_provider_config', {
      company_id: DEMO_COMERCIO, banco_codigo: '748', provider: 'sicredi', ambiente: 'homologacao', ativo: true, cap_boleto: true,
      updated_at: '2026-09-25T12:00:00Z',
    })).id)
  })

  test.afterAll(async () => {
    for (const id of criados) await dbDelete('erp_banco_provider_config', `id=eq.${id}`)
  })

  test('dois bancos: padrão é o configurado por último, dá para trocar e a escolha fica lembrada', async ({ page }) => {
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
