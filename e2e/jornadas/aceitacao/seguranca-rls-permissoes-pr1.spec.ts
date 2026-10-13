// 🚨 Segurança PR 1 (28/09) · tabelas de permissão e acesso (role_permissions, rbac_*, access_config, plan_*,
// module_catalog, screen_route_features, area_menu_config) estavam SEM RLS e com GRANT total ao anon.
// Migration 20260928090000: anon não lê nem escreve; logado só LÊ (o app precisa do menu); escrita só service_role.
// Caminho principal: o login e o menu continuam funcionando na Demonstração Oficina. Nada é gravado.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const TABELAS = ['role_permissions', 'rbac_papel', 'rbac_papel_acesso', 'rbac_subgrupo_catalogo', 'access_config',
  'plan_modules', 'plan_catalog', 'module_catalog', 'screen_route_features', 'area_menu_config']

test.describe('Segurança PR 1 · permissões e acesso fechados ao anon', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-rls-pr1', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('login e menu seguem funcionando (Oficina demo)', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina')
    await aguardarConteudo(page)
    // O menu (itens do menu, celular e computador, nas 6 demos) é exigido em menu-6-demos.spec.ts. A causa do menu
    // vazio da Oficina demo era falta de plano (migration 20260928145000), não esta PR.
    await page.goto('/dashboard/oficina/patio')
    await aguardarConteudo(page)
    await expect(page.getByText(/Recebido|Aguardando aprovação/).first()).toBeVisible({ timeout: 20000 })
  })

  test('anon não lê nem escreve; logado continua lendo o catálogo', { tag: '@pos-migration' }, async () => {
    expect(SUPABASE_URL && ANON_KEY, 'ambiente com URL e chave anon').toBeTruthy()
    const anon = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
    for (const t of TABELAS) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: anon })
      expect(r.status, `anon lendo ${t}`).toBeGreaterThanOrEqual(400)
    }
    const del = await fetch(`${SUPABASE_URL}/rest/v1/role_permissions?id=is.null`, { method: 'DELETE', headers: anon })
    expect(del.status, 'anon apagando role_permissions').toBeGreaterThanOrEqual(400)
    const vinc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_vincular_modulo_aos_planos`, {
      method: 'POST', headers: { ...anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_module_id: 'x' }),
    })
    expect(vinc.status, 'anon executando fn_vincular_modulo_aos_planos').toBeGreaterThanOrEqual(400)

    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const logado = await fetch(`${SUPABASE_URL}/rest/v1/module_catalog?select=id&limit=5`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    })
    expect(logado.status, 'logado lendo module_catalog').toBe(200)
    expect(((await logado.json()) as unknown[]).length).toBeGreaterThan(0)
  })
})
