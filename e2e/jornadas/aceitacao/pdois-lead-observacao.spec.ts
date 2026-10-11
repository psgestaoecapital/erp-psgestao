// #912 Pdois: "Observações" já no modal "Novo lead" (antes só dava para pôr editando o lead depois de criado).
// Cria o lead pela tela na Agência (P&M) - DEMO com a observação e confere no banco que ela gravou na criação.
// Sem migration: fn_agency_lead_criar já aceita `observacoes`. Limpeza sem apagar (RD-30): lead vai para a lixeira.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbPatch, dbSelect, registrarJornada } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const RUN = Date.now().toString(36).toUpperCase()
const EMPRESA = `E2E Lead Obs ${RUN}`
const OBS = `Cliente pediu retorno na sexta · ${RUN}`
let leadId = ''

test.describe('#912 Pdois: observação no novo lead', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AG)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pdois-lead-observacao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (leadId) await dbPatch('agency_leads', `id=eq.${leadId}`, { deleted_at: new Date().toISOString() }).catch(() => {})
  })

  test('novo lead pela tela grava a observação já na criação', async ({ page }) => {
    await page.goto('/dashboard/pm/leads')
    await aguardarConteudo(page)

    await page.getByTestId('lead-novo').click()
    await page.getByTestId('lead-cliente-busca').fill(EMPRESA)
    await page.getByLabel('Contato (nome)', { exact: true }).fill('Maria Teste')
    await page.getByTestId('lead-observacoes').fill(OBS)
    await page.getByTestId('lead-salvar').click()

    await expect.poll(async () => {
      const [l] = await dbSelect<{ id: string; observacoes: string | null }>('agency_leads',
        `company_id=eq.${DEMO_AG}&empresa=eq.${encodeURIComponent(EMPRESA)}&deleted_at=is.null&select=id,observacoes`)
      if (l) leadId = l.id
      return l ? l.observacoes : null
    }, { timeout: 15000, message: 'o lead gravou com a observação digitada no modal' }).toBe(OBS)
  })
})
