// Decisão do CEO (30/09): a Demonstração Comércio (GE) inclui a área Hub (/dashboard/projetos), para as telas de obras,
// oportunidades e propostas serem testadas na aceitação. Só demonstração: nenhuma empresa real muda de plano.
// Migration 20260930170000 · @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO. Somente leitura.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

test.describe('Demonstração GE com a área Hub', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-demo-ge-hub', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('demo GE tem o Hub ativo a R$ 0, é a demo do Hub, e o robô vê a área', { tag: '@pos-migration' }, async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo).toBe(true)
    const subs = await dbSelect<{ status: string; monthly_price_brl: number }>('tenant_subscriptions',
      `company_id=eq.${DEMO_COMERCIO}&plan_id=eq.v15_hub_t1&select=status,monthly_price_brl`)
    expect(subs.filter((s) => s.status === 'active'), 'uma assinatura Hub ativa').toHaveLength(1)
    expect(Number(subs.find((s) => s.status === 'active')?.monthly_price_brl ?? -1), 'demonstração não entra no MRR').toBe(0)
    const [dpa] = await dbSelect<{ company_id: string }>('demo_por_area', 'area=eq.hub&select=company_id')
    expect(dpa?.company_id, 'demo_por_area: o Hub é exercitado na demo GE').toBe(DEMO_COMERCIO)

    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_listar_areas_visiveis`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: DEMO_COMERCIO }),
    })
    expect(resp.ok).toBe(true)
    const areas = (await resp.json()) as { area_slug: string; empresa_tem_acesso: boolean }[]
    expect(areas.find((a) => a.area_slug === 'hub')?.empresa_tem_acesso, 'o robô vê o Hub na demo GE').toBe(true)
  })

  test('tela: /dashboard/projetos/obras abre na demo GE (sem redirecionar para outra área)', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/projetos/obras')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: 'Obras' })).toBeVisible({ timeout: 30000 })
    await expect(page, 'o AreaRedirectGuard deixa o robô no Hub').toHaveURL(/\/dashboard\/projetos\/obras/)
  })
})
