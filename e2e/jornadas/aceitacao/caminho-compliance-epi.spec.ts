// RD-83 · CAMINHO PRINCIPAL da tela Compliance → EPI → Ficha do funcionário, entregue com a correção da entrega de EPI.
// Abrir a ficha, "+ Entregar Novo EPI" (EPI → confirmação NR-6 → assinatura) e conferir no banco: ficha em uso,
// movimentação com hash e assinatura gravada. A ficha tampouco abria (colunas inexistentes) — corrigida junto.
// @pos-migration: depende da migration 20260926350000 (digest) e da Demonstração Indústria (SST).
// Só a demonstração; reset da demo no fim (a entrega some e a demo volta ao seed).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const FUNCIONARIO = 'Mariana Duarte Demo'   // sem EPI no seed
const EPI = 'Óculos de proteção incolor'

test.describe('Caminho principal — EPI: entregar pela ficha do funcionário', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-compliance-epi', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { await rpc('fn_demo_reset', { p_company_id: DEMO_SST }) })

  test('abrir a ficha, entregar o EPI com assinatura e conferir no banco @pos-migration', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [func] = await dbSelect<{ id: string }>('compliance_funcionarios',
      `company_id=eq.${DEMO_SST}&nome_completo=eq.${encodeURIComponent(FUNCIONARIO)}&select=id`)
    const [epi] = await dbSelect<{ id: string }>('epi_catalogo',
      `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent(EPI)}&select=id`)
    expect(func?.id && epi?.id).toBeTruthy()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto(`/dashboard/compliance/epi/ficha/${func.id}`)
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: FUNCIONARIO }), 'a ficha abre (antes: erro de coluna inexistente)').toBeVisible({ timeout: 20000 })
    await expect(page.getByText('EPIs em uso · 0')).toBeVisible()

    await page.getByRole('button', { name: '+ Entregar Novo EPI' }).click()
    const sel = page.locator('select:has(option:has-text("Óculos de proteção incolor"))')
    await expect(sel).toBeVisible({ timeout: 15000 })
    await sel.selectOption(epi.id)
    await page.getByRole('button', { name: 'Continuar →' }).click()
    await expect(page.getByText('Termo de recebimento — NR-6 do MTE')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar para Assinatura →' }).click()

    // assinatura: um traço no canvas
    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + 30, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 30 + i * 20, box.y + box.height / 2 + (i % 2 ? 15 : -15))
    await page.mouse.up()
    await page.getByRole('button', { name: '✓ Confirmar Entrega' }).click()

    await expect(page.getByText('EPIs em uso · 1'), 'a entrega aparece na ficha').toBeVisible({ timeout: 20000 })

    const fichas = await dbSelect<{ status: string }>('epi_ficha',
      `funcionario_id=eq.${func.id}&catalogo_id=eq.${epi.id}&select=status`)
    expect(fichas.map((f) => f.status)).toEqual(['em_uso'])
    const movs = await dbSelect<{ id: string; hash_integridade: string | null }>('epi_movimentacao',
      `funcionario_id=eq.${func.id}&catalogo_id=eq.${epi.id}&select=id,hash_integridade`)
    expect(movs).toHaveLength(1)
    expect(movs[0].hash_integridade).toMatch(/^[0-9a-f]{64}$/)
    const ass = await dbSelect<{ metodo: string; hash_integridade: string | null }>('epi_assinatura',
      `movimentacao_id=eq.${movs[0].id}&select=metodo,hash_integridade`)
    expect(ass, 'assinatura gravada').toHaveLength(1)
    expect(ass[0].metodo).toBe('eletronica_desenhada')
    expect(ass[0].hash_integridade).toMatch(/^[0-9a-f]{64}$/)
  })
})
