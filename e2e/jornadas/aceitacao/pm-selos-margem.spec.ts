// P&M (CEO 01/10, antes do teste da Pdois). Sem migration: roda no preview, na Agência (P&M) - DEMO, sem gravar nada.
//  1) Selos de estado só para a equipe PS. O robô é da equipe PS → vê o selo. Para ver como CLIENTE, a resposta de
//     users.system_role é trocada por null no navegador (é a única coisa que a tela usa para decidir) → nenhum selo,
//     nem no menu nem no título da tela do módulo.
//  2) Margem por Job: a demo tem horas apontadas sem custo/hora → a linha do job pede "Cadastre o custo da hora da
//     equipe" (sem lucro), o aviso leva à tela Equipe.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'
import type { Page } from '@playwright/test'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'

async function comoCliente(page: Page) {
  await page.route((url) => url.pathname.endsWith('/rest/v1/users') && url.searchParams.get('select') === 'system_role', async (route) => {
    const objeto = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(objeto ? { system_role: null } : [{ system_role: null }]) })
  })
}

test.describe('P&M · selos só para a equipe PS; margem sem custo/hora pede o cadastro', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AG)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-selos-margem', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('equipe PS vê o selo do módulo e do menu', async ({ page }) => {
    await page.goto('/dashboard/pm/eventos')
    await aguardarConteudo(page)
    await expect(page.getByTestId('modulo-selo-estado')).toBeVisible()
    await expect.poll(async () => page.getByTestId('menu-selo').count(), { timeout: 15000, message: 'o menu mostra selos para a PS' }).toBeGreaterThan(0)
  })

  test('cliente não vê selo nenhum — nem no menu, nem no título do módulo', async ({ page }) => {
    await comoCliente(page)
    await page.goto('/dashboard/pm/eventos')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Leads / CRM' }).first()).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(1500) // dá tempo de o selo aparecer, se fosse aparecer
    await expect(page.getByTestId('modulo-selo-estado')).toHaveCount(0)
    await expect(page.getByTestId('menu-selo')).toHaveCount(0)
    await expect(page.getByText(/^(Previsto|Pronto|Parcial|Em breve)$/i)).toHaveCount(0)
  })

  test('Margem por Job: horas sem custo/hora → "Cadastre o custo da hora da equipe", sem lucro; leva à tela Equipe', async ({ page }) => {
    const [ap] = await dbSelect<{ job_id: string }>('agency_timesheet',
      `company_id=eq.${DEMO_AG}&horas=gt.0&or=(custo_hora.is.null,custo_hora.eq.0)&job_id=not.is.null&select=job_id&limit=1`)
    expect(ap, 'a demo tem hora apontada sem custo/hora').toBeTruthy()

    await page.goto('/dashboard/pm/margem-job')
    await aguardarConteudo(page)
    const linha = page.getByTestId(`margem-job-${ap.job_id}`)
    await expect(linha).toContainText('Cadastre o custo da hora da equipe')
    await expect(linha).not.toContainText('%')
    await expect(page.getByTestId('margem-aviso-custo-hora')).toContainText('Cadastre o custo da hora da equipe')
    await expect(page.getByTestId('margem-fora-do-total')).toBeVisible()

    await page.getByTestId('margem-cadastrar-custo-hora').click()
    await expect(page).toHaveURL(/\/dashboard\/pm\/equipe/)
    await aguardarConteudo(page)
  })
})
