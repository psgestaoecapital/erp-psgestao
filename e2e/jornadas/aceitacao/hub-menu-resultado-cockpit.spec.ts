// Hub — telas novas no caminho do usuário (CEO 08/10): do Painel, em até 3 toques, chega em Resultado por obra e no Cockpit.
// Demonstração Comércio (GE), obra de teste desta execução (cancelada no fim — RD-30). Depende da view v_obra_resultado → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
let obraTeste = ''

test.describe('Hub — menu: Resultado por obra e Cockpit', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-menu-resultado-cockpit', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (obraTeste) await dbPatch('projetos_obras', `id=eq.${obraTeste}`, { status: 'cancelada', observacoes: 'e2e — obra de teste encerrada' }).catch(() => {})
  })

  test('do Painel: Novidades → Resultado por obra; aba Cockpit → lista → cockpit da obra', { tag: '@pos-migration' }, async ({ page }) => {
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2M-${RUN}`, nome: `E2E menu ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)

    await page.goto('/dashboard/projetos')
    await aguardarConteudo(page)
    await page.getByTestId('novidades-hub').getByRole('link', { name: /Resultado por obra/ }).click()
    await expect(page).toHaveURL(/\/projetos\/obras\/resultado/)

    await page.getByRole('link', { name: 'Cockpit', exact: true }).first().click()
    await expect(page).toHaveURL(/\/projetos\/cockpit/)
    await page.getByTestId('cockpit-lista').getByRole('link', { name: new RegExp(`E2M-${RUN}`) }).click({ timeout: 30000 })
    await expect(page.getByTestId('hub-cockpit-obra')).toContainText(`E2M-${RUN}`, { timeout: 30000 })
  })
})
