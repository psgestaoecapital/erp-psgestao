// Hub — Resultado por obra e Cockpit chegam pelo MENU/abas (a entrega só vale se o usuário acha a tela).
// Demonstração Comércio (GE). Abas: Painel → Resultado (1 toque), Painel → Cockpit → obra (2 toques).
// A obra de teste fica cancelada no fim (RD-30). O passo do cockpit lê v_obra_resultado → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
let obraTeste = ''

test.describe('Hub — telas novas no menu', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb0-menu-resultado-cockpit', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (obraTeste) await dbPatch('projetos_obras', `id=eq.${obraTeste}`, { status: 'cancelada', observacoes: 'e2e — obra de teste encerrada' }).catch(() => {})
  })

  test('painel mostra Novidades e a aba Resultado abre a tela', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos')
    await aguardarConteudo(page)
    await expect(page.getByTestId('novidades-hub')).toBeVisible({ timeout: 30000 })
    await page.getByRole('link', { name: 'Resultado', exact: true }).first().click()
    await expect(page).toHaveURL(/\/dashboard\/projetos\/obras\/resultado/)
  })

  test('aba Cockpit lista a obra e abre o cockpit em até 3 toques', { tag: '@pos-migration' }, async ({ page }) => {
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2M-${RUN}`, nome: `E2E menu ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos')
    await aguardarConteudo(page)
    await page.getByRole('link', { name: 'Cockpit', exact: true }).first().click()
    const link = page.getByTestId('cockpit-obra-link').filter({ hasText: `E2M-${RUN}` })
    await expect(link).toBeVisible({ timeout: 30000 })
    await link.click()
    await expect(page.getByTestId('hub-cockpit-obra')).toContainText(`E2M-${RUN}`, { timeout: 30000 })
  })
})
