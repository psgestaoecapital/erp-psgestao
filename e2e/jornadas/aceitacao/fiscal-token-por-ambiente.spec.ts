// Configuração Fiscal · token da Focus por ambiente (migration 20261126100030, @pos-migration). Só LEITURA na Demonstração
// Comércio: a função de estado devolve o formato por ambiente (sem valor de token) e a tela mostra, ao lado de cada campo de
// token, se ele está gravado. Não grava nem lê token. NUNCA roda em empresa real.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
let token = ''

test.describe('Configuração Fiscal · token por ambiente', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-fiscal-token-por-ambiente', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('fn_fiscal_token_status devolve o estado por ambiente, sem valor de token', { tag: '@pos-migration' }, async () => {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_fiscal_token_status`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: DEMO }),
    })
    expect(resp.ok).toBe(true)
    const r = (await resp.json()) as { ok: boolean; homologacao: { configurado: boolean }; producao: { configurado: boolean } }
    expect(r.ok).toBe(true)
    expect(typeof r.homologacao.configurado).toBe('boolean')
    expect(typeof r.producao.configurado).toBe('boolean')
    expect(JSON.stringify(r), 'nenhum valor de segredo na resposta').not.toMatch(/secret|token"/i)
  })

  test('tela Configuração Fiscal mostra o estado de cada token', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/configuracoes/fiscal')
    await aguardarConteudo(page)
    // o cartão de tokens só aparece com o provedor Focus; se a demo estiver no gov.br, o teste não se aplica
    const campo = page.getByTestId('focus-token-homolog')
    test.skip(!(await campo.isVisible().catch(() => false)), 'demo sem provedor Focus selecionado')
    await expect(page.getByTestId('focus-token-homolog-status')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('focus-token-prod-status')).toBeVisible()
  })
})
