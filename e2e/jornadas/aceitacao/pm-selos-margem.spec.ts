// P&M (CEO 01/10, antes do teste da Pdois). Sem migration: roda no preview, na Agência (P&M) - DEMO, sem gravar nada.
//  1) Selos de estado só para a equipe PS. O robô é da equipe PS → vê o selo. Para ver como CLIENTE, a resposta de
//     users.system_role é trocada por null no navegador (é a única coisa que a tela usa para decidir) → nenhum selo,
//     nem no menu nem no título da tela do módulo.
//  2) Margem por Job: a demo tem horas apontadas sem custo/hora → a linha do job pede "Cadastre o custo da hora da
//     equipe" (sem lucro), o aviso leva à Mão de obra (CEO 03/10: o custo da hora vem de lá, não mais da tela Equipe).

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

// abre o menu como o usuário faz (celular: gaveta; computador: menu lateral) e abre todas as seções da sanfona
async function abrirMenu(page: Page) {
  const gaveta = page.getByTestId('mobile-drawer-toggle')
  const celular = await gaveta.isVisible().catch(() => false)
  if (celular) await gaveta.click()
  const menu = page.getByTestId(celular ? 'menu-gaveta' : 'menu-lateral')
  await expect(menu).toBeVisible({ timeout: 10000 })
  const itens = menu.locator('nav').locator('a[href], button')
  await expect.poll(async () => itens.count(), { timeout: 20000, message: 'menu carregou' }).toBeGreaterThan(0)
  for (let i = 0; i < 6; i++) {
    const fechada = menu.locator('nav button[aria-expanded="false"]').first()
    if (!(await fechada.count())) break
    await fechada.click()
  }
  await expect.poll(async () => menu.locator('nav a[href]').count(), { timeout: 20000, message: 'telas do menu visíveis' }).toBeGreaterThanOrEqual(3)
  return menu
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
    await page.goto('/dashboard/pm/eventos?area=pm')
    await aguardarConteudo(page)
    await expect(page.getByTestId('modulo-selo-estado')).toBeVisible()
    const menu = await abrirMenu(page)
    await expect.poll(async () => menu.getByTestId('menu-selo').count(), { timeout: 15000, message: 'o menu mostra selos para a PS' }).toBeGreaterThan(0)
  })

  test('cliente não vê selo nenhum — nem no menu, nem no título do módulo', async ({ page }) => {
    await comoCliente(page)
    await page.goto('/dashboard/pm/eventos?area=pm')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const menu = await abrirMenu(page)
    await page.waitForTimeout(1500) // dá tempo de o selo aparecer, se fosse aparecer
    await expect(page.getByTestId('modulo-selo-estado')).toHaveCount(0)
    await expect(menu.getByTestId('menu-selo')).toHaveCount(0)
    await expect(menu.getByText(/^(Previsto|Pronto|Parcial|em breve)$/i)).toHaveCount(0)
  })

  test('Margem por Job: horas sem custo/hora → "Cadastre o custo da hora da equipe", sem lucro; leva à Mão de obra', async ({ page }) => {
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
    await expect(page).toHaveURL(/\/dashboard\/_compartilhado\/mao-obra\?area=pm/)
    await aguardarConteudo(page)
  })
})
