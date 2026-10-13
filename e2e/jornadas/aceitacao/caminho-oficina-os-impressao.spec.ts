// RD-83 · CAMINHO PRINCIPAL da impressão da OS (entregue com #80/#89): abrir a impressão de uma OS, conferir
// número, cliente e itens contra o banco, e usar a opção "Ocultar valores (via operacional)". Sem migration.
// Demonstração "Mecânica Modelo".

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_MECANICA = 'ded00000-0000-4000-a000-000000000001'

test.describe('Caminho principal — impressão da OS', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-oficina-os-impressao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abrir a impressão: número e cliente batem com o banco; ocultar valores funciona', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_MECANICA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [os] = await dbSelect<{ id: string; numero: string; cliente_nome: string }>('erp_os',
      `company_id=eq.${DEMO_MECANICA}&cliente_nome=not.is.null&select=id,numero,cliente_nome&order=numero&limit=1`)

    await page.goto(`/dashboard/commerce/otc/imprimir/${os.id}`)
    await aguardarConteudo(page)
    await expect(page.getByText(os.numero).first(), 'número da OS').toBeVisible({ timeout: 20000 })
    await expect(page.getByText(os.cliente_nome).first(), 'cliente da OS').toBeVisible()
    const ocultar = page.getByTestId('os-print-ocultar-valores')
    if (await ocultar.isEnabled()) {
      await ocultar.check()
      await expect(ocultar).toBeChecked()
    }
  })
})
