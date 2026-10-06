// P&M D0 (Pdois, 06/10): as telas da jornada do primeiro dia abrem sem erro na Agência DEMO (leitura; nada é gravado).
// Contratos/fee → Pauta → Briefings → Aprovação → Apontamento de horas → Meu dia. Sem ação real (fixtures bloqueiam).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const TELAS = ['contratos', 'pauta', 'briefings', 'aprovacao', 'apontamento-horas', 'meu-dia']

test.describe('P&M D0 — telas da jornada do primeiro dia', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AG)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-d0-jornada-telas', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  for (const tela of TELAS) {
    test(`${tela} abre sem erro`, async ({ page }) => {
      const erros: string[] = []
      page.on('pageerror', (e) => erros.push(e.message))
      await page.goto(`/dashboard/pm/${tela}`)
      await aguardarConteudo(page)
      await expect(page.locator('body')).not.toContainText(/Application error|Something went wrong|Erro inesperado/i)
      expect(erros, `erros de página em ${tela}`).toEqual([])
    })
  }
})
