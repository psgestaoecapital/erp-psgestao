// P&M · apontamento de horas em 1 toque (onda 2 da P&M da Pdois, mapeamento do SIGA, Parte S, atrito 18).
// Migration 20261009153020 (textos do "?") · @pos-migration. Na "Agência (P&M) - DEMO", como o robô:
//   1) o link "Lançar horas" (?job=) abre o Apontamento com o job já escolhido;
//   2) um toque em "+30 min" grava 0,5 h nesse job, para o robô, com a data de hoje — sem digitar nada;
//   3) Meus trabalhos mostra o "?" do ▶ (e o ▶ em cada job do robô, quando houver).
// Limpeza: a linha de horas criada pelo teste é apagada (só ela, pelo id).
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbDelete, dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'

test.describe('P&M — apontar horas em 1 toque', () => {
  let me = ''
  const criadas: string[] = []
  test.beforeAll(async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    me = (JSON.parse(atob(token.split('.')[1])) as { sub: string }).sub
  })
  test.afterAll(async () => {
    for (const id of criadas) await dbDelete('agency_timesheet', `id=eq.${id}`).catch(() => {})
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-apontar-1-toque', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('link com ?job= abre com o job e "+30 min" grava 0,5 h em 1 toque', { tag: '@pos-migration' }, async ({ page }) => {
    const [job] = await dbSelect<{ id: string }>('agency_jobs', `company_id=eq.${DEMO_PM}&select=id&order=created_at.desc&limit=1`)
    expect(job, 'a demo da Agência tem job').toBeTruthy()
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    const antes = new Date(Date.now() - 5_000).toISOString()
    await page.goto(`/dashboard/pm/apontamento-horas?job=${job.id}`)
    await aguardarConteudo(page)
    await expect(page.getByTestId('apont-job')).toHaveValue(job.id, { timeout: 20000 })
    await expect(page.getByTestId('ajuda-pm.apontamento.atalho')).toBeVisible()
    await page.getByTestId('apont-atalho-0.5').click()
    await expect(page.getByText(/Apontamento CRIADO · 0\.5h/)).toBeVisible({ timeout: 15000 })
    const linhas = await dbSelect<{ id: string; horas: number }>('agency_timesheet', `company_id=eq.${DEMO_PM}&job_id=eq.${job.id}&user_id=eq.${me}&created_at=gte.${encodeURIComponent(antes)}&select=id,horas`)
    criadas.push(...linhas.map((l) => l.id))
    expect(linhas.map((l) => Number(l.horas)), 'um toque = uma linha de 0,5 h').toEqual([0.5])
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-apontar-1-toque.png', fullPage: true })

    await page.goto('/dashboard/pm/meus-trabalhos')
    await aguardarConteudo(page)
    await expect(page.getByTestId('meus-trabalhos-page')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('ajuda-pm.meus_trabalhos.apontar')).toBeVisible()
    const nJobs = await page.getByTestId('mt-job').count()
    if (nJobs) await expect(page.getByTestId('mt-job').first().locator('[data-testid^="btn-play-"]')).toBeVisible()
  })
})
