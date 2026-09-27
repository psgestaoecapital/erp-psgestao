// #147 (Alliance) · GE → Estoque mostra os veículos do pátio da Revenda (aba "Veículos"), lidos na fonte
// (fn_veic_estoque_ge — sem copiar para erp_produtos). Migration 20260927230000.
// Só leitura, na Demonstração Revenda: nada é criado nem alterado.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'
const SIT_ESTOQUE = ['em_preparacao', 'disponivel', 'reservado', 'consignado', 'devolvido']

test.describe('Estoque da GE puxa os veículos do pátio (#147)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_REVENDA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-ge-estoque-veiculos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('o Estoque da GE abre normalmente na empresa de revenda', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_REVENDA)
    await page.goto('/dashboard/commerce/estoque')
    await aguardarConteudo(page)
    await expect(page.getByTestId('estoque-tab-saldo-count')).toBeVisible({ timeout: 20000 })
  })

  test('a aba Veículos lista o estoque do pátio (consignado não soma)', { tag: '@pos-migration' }, async ({ page }) => {
    const veics = await dbSelect<{ id: string; origem: string | null; situacao: string }>('veic_veiculo',
      `company_id=eq.${DEMO_REVENDA}&deleted_at=is.null&or=(ativo.is.null,ativo.eq.true)&situacao=in.(${SIT_ESTOQUE.join(',')})&select=id,origem,situacao`)
    const proprios = veics.filter((v) => v.origem !== 'consignacao' && v.situacao !== 'consignado').length
    expect(veics.length, 'a demo tem carros no pátio').toBeGreaterThan(0)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_REVENDA)
    await page.goto('/dashboard/commerce/estoque')
    await aguardarConteudo(page)
    await page.getByTestId('estoque-tab-veiculos').click({ timeout: 20000 })
    await expect(page.getByTestId('estoque-veiculos')).toBeVisible()
    await expect(page.getByTestId('estoque-veiculo-linha')).toHaveCount(veics.length)
    await expect(page.getByTestId('estoque-veiculos-qtd')).toHaveText(String(proprios))
  })
})
