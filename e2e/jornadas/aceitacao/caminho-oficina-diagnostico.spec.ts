// RD-83 · CAMINHO PRINCIPAL da tela Oficina → Diagnóstico (entregue com o #102): escolher a OS, escrever o
// diagnóstico e salvar o laudo → gravado no banco. Só frontend. Demonstração Oficina (OS BOT-DIAG); o texto
// original do diagnóstico é restaurado no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

test.describe('Caminho principal — Diagnóstico: salvar o laudo', () => {
  let osId = ''
  let original: string | null = null

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-oficina-diagnostico', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { if (osId) await dbPatch('erp_os', `id=eq.${osId}`, { diagnostico: original }) })

  test('abrir a OS, escrever o diagnóstico e salvar → gravado na OS', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [os] = await dbSelect<{ id: string; diagnostico: string | null }>('erp_os', `company_id=eq.${DEMO_OFICINA}&numero=eq.BOT-DIAG&select=id,diagnostico`)
    osId = os.id; original = os.diagnostico

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/diagnostico')
    await aguardarConteudo(page)
    await page.getByText('BOT-DIAG').first().click()
    const texto = `Caminho diagnóstico ${RUN}: pastilha dianteira gasta.`
    await page.getByPlaceholder(/barulho ao frear/).fill(texto)
    await page.getByRole('button', { name: 'Salvar laudo' }).click()
    await expect.poll(async () => (await dbSelect<{ diagnostico: string | null }>('erp_os', `id=eq.${osId}&select=diagnostico`))[0]?.diagnostico,
      { timeout: 20000 }).toBe(texto)
  })
})
