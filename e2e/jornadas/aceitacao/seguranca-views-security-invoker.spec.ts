// 🚨 Segurança (28/09, prioridade 3) · views com direitos do dono mostravam dado de TODAS as empresas a quem estava
// logado. Migration 20260928110000: security_invoker em todas as views + leitura alinhada a get_user_company_ids()
// (suporte PS continua vendo as empresas que atende). Só leitura, nas empresas de demonstração.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

async function ler(token: string, caminho: string): Promise<{ status: number; linhas: number }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
  const corpo = r.ok ? ((await r.json()) as unknown[]) : []
  return { status: r.status, linhas: corpo.length }
}

test.describe('Segurança · views respeitam a empresa de quem consulta', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-views-invoker', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('painel da GE abre na demo', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard')
    await aguardarConteudo(page)
    await expect(page.locator('body')).toBeVisible()
  })

  test('suporte PS segue lendo as views de compliance/títulos das empresas que atende', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const comp = await ler(token, `v_compliance_matriz_funcionarios?company_id=eq.${DEMO_SST}&select=company_id&limit=5`)
    expect(comp.status, 'v_compliance_matriz_funcionarios').toBe(200)
    expect(comp.linhas, 'compliance da demo SST visível ao suporte PS').toBeGreaterThan(0)
    const tit = await ler(token, `v_titulos_consolidados?company_id=eq.${DEMO_GE}&select=company_id&limit=5`)
    expect(tit.status, 'v_titulos_consolidados').toBe(200)
    expect(tit.linhas, 'títulos da demo GE visíveis ao suporte PS').toBeGreaterThan(0)
  })
})
