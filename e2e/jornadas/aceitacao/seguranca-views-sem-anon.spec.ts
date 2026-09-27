// 🚨 Segurança (28/09) · 125 das 128 views do schema public eram legíveis pelo anon — e 105 rodam com direitos do
// dono, furando a RLS (ex.: v_user_permissions_resolved devolvia 21.400 linhas só com a chave pública).
// Migration 20260928093000: nenhuma view legível sem login. Logado e chave de serviço não mudam. Nada é gravado.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const VIEWS = ['v_user_permissions_resolved', 'v_projetos_resumo_empresa', 'v_companies_plano_compat',
  'v_epi_ficha_funcionario', 'v_compliance_matriz_funcionarios', 'v_sync_health', 'v_alertas_ativos']

test.describe('Segurança · views fechadas ao anon', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-views-anon', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('logado continua lendo as views do app (painel da GE e alertas)', async ({ page }) => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const r = await fetch(`${SUPABASE_URL}/rest/v1/v_alertas_ativos?select=*&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    })
    expect(r.status, 'logado lendo v_alertas_ativos').toBe(200)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard')
    await aguardarConteudo(page)
    await expect(page.locator('main, [role="main"], body').first()).toBeVisible()
  })

  test('anon não lê nenhuma view', { tag: '@pos-migration' }, async () => {
    expect(SUPABASE_URL && ANON_KEY, 'ambiente com URL e chave anon').toBeTruthy()
    for (const v of VIEWS) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${v}?select=*&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } })
      expect(r.status, `anon lendo ${v}`).toBeGreaterThanOrEqual(400)
    }
  })
})
