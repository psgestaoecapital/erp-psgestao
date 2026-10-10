// PS EHS · E0 regressão — toda rota de /dashboard/compliance/* existente hoje continua abrindo (não 404, sem erro de
// aplicação). Inventário em docs/ehs/E0-inventario-telas-compliance.md. Demonstração Indústria (SST); só leitura.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const ROTAS = [
  '', '/calendario', '/empresa', '/documentos-exigidos', '/funcionarios', '/matriz', '/setores', '/sst',
  '/treinamentos', '/treinamentos-por-setor', '/pausas-tecnicas', '/prestadores', '/epi', '/epi/alertas',
  '/epi/catalogo', '/epi/estoque', '/epi/fichas', '/whatsapp-epi', '/validacao-automatica',
]

test.describe('PS EHS E0 — regressão: as telas de Compliance continuam abrindo', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('ehs-e0-regressao-telas', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  for (const rota of ROTAS) {
    test(`abre /dashboard/compliance${rota}`, async ({ page }) => {
      const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
      expect(emp?.is_demo, 'só na demonstração').toBe(true)
      await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
      const resp = await page.goto(`/dashboard/compliance${rota}`)
      expect(resp?.status(), 'rota existe').toBeLessThan(400)
      await aguardarConteudo(page)
      await expect(page.getByText(/application error|This page could not be found|Algo deu errado/i)).toHaveCount(0)
    })
  }

  test('ficha de EPI e ficha do funcionário abrem', async ({ page }) => {
    const [f] = await dbSelect<{ id: string }>('compliance_funcionarios', `company_id=eq.${DEMO_SST}&ativo=eq.true&select=id&limit=1`)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    for (const url of [`/dashboard/compliance/funcionarios/${f.id}`, `/dashboard/compliance/epi/ficha/${f.id}`]) {
      const resp = await page.goto(url)
      expect(resp?.status(), url).toBeLessThan(400)
      await aguardarConteudo(page)
    }
  })
})
