// Hub — Painel do Hub (PDCA 23/10): indicadores reais, funil e obras por situação, cada um com o "?" (RD-95).
// Só leitura na Demonstração Comércio (GE): nada é gravado. O número de obras em andamento tem de bater com o banco.
// O texto do "?" vem da migration 20261023233500 → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Hub — Painel com indicadores do banco', () => {
  test('indicadores, funil e obras por situação batem com o banco e têm "?"', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos')
    await aguardarConteudo(page)
    await expect(page.getByTestId('painel-indicadores')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('painel-funil')).toBeVisible()
    await expect(page.getByTestId('painel-obras-situacao')).toBeVisible()

    const obras = await dbSelect<{ id: string }>('projetos_obras', `select=id&company_id=eq.${DEMO}&status=eq.em_andamento`)
    await expect(page.getByTestId('kpi-obras-ativas')).toHaveText(String(obras.length), { timeout: 30000 })
    await expect(page.getByTestId('situacao-em_andamento')).toContainText(String(obras.length))

    for (const chave of ['projetos.painel.kpi.obras_ativas', 'projetos.painel.kpi.margem_prevista', 'projetos.painel.funil', 'projetos.painel.obras_situacao']) {
      await expect(page.getByTestId(`ajuda-${chave}`)).toBeVisible()
    }
    await page.getByTestId('ajuda-projetos.painel.kpi.margem_prevista').click()
    await expect(page.getByTestId('ajuda-cartao-projetos.painel.kpi.margem_prevista')).toContainText('receita prevista')
  })
})
