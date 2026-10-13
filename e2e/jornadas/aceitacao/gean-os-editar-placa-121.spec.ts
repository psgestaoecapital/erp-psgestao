// #121 (Gean) · "Na aba Editar OS, adicionar a opção de editar placa — placa lançada OKG8B38, correta OKG8D38."
// A ficha da OS não mostrava nem editava a placa (o "informar placa" do pátio só aparece quando a OS NÃO tem placa).
// Agora a ficha tem o campo Placa com "Salvar placa" (mesma RPC do pátio, fn_oficina_os_set_placa, já em produção).
// Só front — roda no preview. Demonstração Oficina (OS BOT-APONT); a placa original é devolvida no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const NOVA = 'TST1D21'

test.describe('Ficha da OS — editar a placa (#121)', () => {
  let osId = ''
  let original: string | null = null

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [os] = await dbSelect<{ id: string; placa: string | null }>('erp_os', `company_id=eq.${DEMO_OFICINA}&numero=eq.BOT-APONT&select=id,placa`)
    expect(os, 'a demo tem a OS BOT-APONT').toBeTruthy()
    osId = os.id
    original = os.placa
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-os-editar-placa-121', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (osId) await dbPatch('erp_os', `id=eq.${osId}`, { placa: original })
  })

  test('corrigir a placa na ficha grava no banco já normalizada', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/os')
    await aguardarConteudo(page)
    await page.getByTestId('os-row').filter({ hasText: 'BOT-APONT' }).getByTestId('os-editar').click()
    await expect(page.getByTestId('os-placa')).toBeVisible({ timeout: 20000 })

    await page.getByTestId('os-placa').fill('tst-1d21')
    await page.getByTestId('os-placa-salvar').click()
    await expect(page.getByTestId('os-placa-msg')).toHaveText(`Placa SALVA: ${NOVA}`, { timeout: 20000 })
    await expect.poll(async () => (await dbSelect<{ placa: string | null }>('erp_os', `id=eq.${osId}&select=placa`))[0]?.placa,
      { timeout: 20000 }).toBe(NOVA)

    // placa curta demais: avisa e não grava
    await page.getByTestId('os-placa').fill('AB1')
    await page.getByTestId('os-placa-salvar').click()
    await expect(page.getByTestId('os-placa-msg')).toContainText('Placa inválida')
    expect((await dbSelect<{ placa: string | null }>('erp_os', `id=eq.${osId}&select=placa`))[0]?.placa).toBe(NOVA)
  })
})
