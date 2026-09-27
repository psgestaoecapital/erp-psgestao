// 🚨 Menu vazio (CEO 28/09: "cliente sem menu no celular é cliente parado"). O menu vem SÓ de módulo pago
// (fn_modulos_sidebar_por_area ← tenant_subscriptions ativa). Oficina - DEMO, Agência (P&M) - DEMO e Mecânica Modelo
// - DEMO nunca tiveram plano → gaveta (celular) e menu lateral (computador) vazios. Migration 20260928145000 dá o plano
// completo R$ 0 às demos e o reset passa a mantê-lo. Roda nos dois projetos (celular 390px e computador): conta os
// itens DO MENU (não links da página). As 3 que já tinham plano provam o caminho principal no preview; as 3 corrigidas
// levam @pos-migration (só passam com a migration aplicada). No CI a aceitação roda o projeto celular.
// O vigia no briefing (fn_menu_vazio_auditar) também tem que sair limpo em produção. Nada é gravado.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada, rpc } from '../../support/api'

const DEMOS = [
  { nome: 'Revenda', id: 'b0700000-0000-4000-a000-000000000003', rota: '/dashboard/revenda/patio', area: 'revenda_veiculos', posMigration: false },
  { nome: 'Comércio (GE)', id: 'b0700000-0000-4000-a000-000000000004', rota: '/dashboard/gestao-empresarial', area: 'gestao_empresarial', posMigration: false },
  { nome: 'Indústria (SST)', id: 'b0700000-0000-4000-a000-000000000005', rota: '/dashboard/compliance', area: 'compliance', posMigration: false },
  { nome: 'Oficina', id: 'b0700000-0000-4000-a000-000000000001', rota: '/dashboard/oficina', area: 'oficina', posMigration: true },
  { nome: 'Agência (P&M)', id: 'b0700000-0000-4000-a000-000000000002', rota: '/dashboard/pm', area: 'pm', posMigration: true },
  { nome: 'Mecânica Modelo', id: 'ded00000-0000-4000-a000-000000000001', rota: '/dashboard/oficina', area: 'oficina', posMigration: true },
]

test.describe('Menu com itens nas 6 demonstrações (celular e computador)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-menu-6-demos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  for (const d of DEMOS) {
    test(`menu da demo ${d.nome} tem itens`, d.posMigration ? { tag: '@pos-migration' } : {}, async ({ page }) => {
      await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, d.id)
      await page.goto(`${d.rota}?area=${d.area}`)
      await aguardarConteudo(page)

      // celular: abre a gaveta como o usuário faz; computador: menu lateral fixo
      const gaveta = page.getByTestId('mobile-drawer-toggle')
      const celular = await gaveta.isVisible().catch(() => false)
      if (celular) await gaveta.click()
      const menu = page.getByTestId(celular ? 'menu-gaveta' : 'menu-lateral')
      await expect(menu).toBeVisible({ timeout: 10000 })

      const itens = menu.locator('nav').locator('a[href], button')
      await expect.poll(async () => itens.count(), { timeout: 20000, message: `itens no menu (${celular ? 'celular' : 'computador'})` })
        .toBeGreaterThanOrEqual(3)
      await expect(menu.getByText('Sem plano ativo nesta área')).toHaveCount(0)
      await expect(menu.getByText('Carregando menu…')).toHaveCount(0)
    })
  }

  test('vigia do briefing: nenhuma área visível com menu vazio (clientes e demos)', { tag: '@pos-migration' }, async () => {
    const r = await rpc<{ ok: boolean; total_achados: number; clientes: unknown[]; demos: unknown[] }>('fn_menu_vazio_auditar', {})
    expect(r.demos, 'demos sem menu').toEqual([])
    expect(r.clientes, 'clientes sem menu').toEqual([])
    expect(r.ok).toBe(true)
  })
})
