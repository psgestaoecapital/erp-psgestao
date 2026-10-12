// HB0 fatia 1 — cockpit da obra (/dashboard/projetos/obras/[id]/cockpit), lendo só v_obra_resultado (#2238).
// Demonstração Comércio (GE), obra de teste desta execução, sem lançamentos: os quatro cartões aparecem zerados,
// "Obra sem itens contratados" entra nas pendências e id inexistente mostra o aviso. A obra de teste fica cancelada
// no fim (RD-30: nada é apagado). Depende da view da migration 20261008150005 → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
let obraTeste = ''

test.describe('HB0 — cockpit da obra', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb0-cockpit-obra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (obraTeste) await dbPatch('projetos_obras', `id=eq.${obraTeste}`, { status: 'cancelada', observacoes: 'e2e — obra de teste encerrada' }).catch(() => {})
  })

  test('cartões zerados e pendência de obra sem itens; obra inexistente avisa', { tag: '@pos-migration' }, async ({ page }) => {
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2E-${RUN}`, nome: `E2E cockpit ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)

    await page.goto(`/dashboard/projetos/obras/${o.id}/cockpit`)
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-cockpit-obra')
    await expect(tela).toContainText(`E2E-${RUN}`, { timeout: 30000 })
    for (const k of ['receita', 'custo', 'margem', 'avanco']) await expect(tela.getByTestId(`cockpit-${k}`)).toBeVisible()
    await expect(tela.getByTestId('cockpit-receita')).toContainText(/R\$\s?0,00/)
    await expect(tela.getByTestId('cockpit-pendencias')).toContainText('Obra sem itens contratados')

    await page.goto('/dashboard/projetos/obras/00000000-0000-4000-a000-00000000e2e0/cockpit')
    await expect(page.getByTestId('hub-cockpit-obra')).toContainText('Obra não encontrada ou sem acesso', { timeout: 30000 })
  })
})
