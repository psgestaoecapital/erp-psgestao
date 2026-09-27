// RD-83 · CAMINHO PRINCIPAL da tela Ordens de Serviço → ficha (Editar), entregue com o #121 (placa editável).
// Abrir a lista, achar a OS da demonstração, abrir a ficha pelo "Editar" e ver os dados principais. Só leitura.
// Demonstração Oficina (OS BOT-APONT).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'

test.describe('Caminho principal — Ordens de Serviço, ficha', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-os-ficha', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abrir a lista, abrir a ficha pelo Editar e ver status, placa e cliente', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [os] = await dbSelect<{ placa: string | null; cliente_nome: string | null }>('erp_os',
      `company_id=eq.${DEMO_OFICINA}&numero=eq.BOT-APONT&select=placa,cliente_nome`)
    expect(os, 'a demo tem a OS BOT-APONT').toBeTruthy()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/os')
    await aguardarConteudo(page)
    const linha = page.getByTestId('os-row').filter({ hasText: 'BOT-APONT' })
    await expect(linha).toBeVisible({ timeout: 20000 })
    await linha.getByTestId('os-editar').click()

    await expect(page.getByText('Ficha de OS')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('os-status-select')).toBeVisible()
    await expect(page.getByTestId('os-placa')).toHaveValue(os.placa ?? '')
    if (os.cliente_nome) await expect(page.getByTestId('os-cliente-nome')).toHaveValue(os.cliente_nome)
  })
})
