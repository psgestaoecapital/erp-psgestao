// RD-83 · CAMINHO PRINCIPAL do acerto de contas da venda (Revenda → Vendas), entregue com a correção do acerto:
// abrir uma venda entregue, abrir "Acerto de contas" e conferir que o lucro real mostrado é o que o banco calcula.
// Sem migration própria (lê a função vigente): roda no preview. Demonstração Revenda.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const num = (t: string | null) => Number(String(t ?? '').replace(/[^\d,-]/g, '').replace(',', '.'))

test.describe('Caminho principal — acerto de contas da venda', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-revenda-acerto', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abrir o acerto de uma venda entregue: lucro real da tela = banco', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_REVENDA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    await page.goto('/dashboard/revenda/vendas')
    await aguardarConteudo(page)
    const botao = page.getByRole('button', { name: /Acerto de contas/i }).first()
    await expect(botao).toBeVisible({ timeout: 20000 })
    await botao.click()
    const linha = page.getByTestId('acerto-lucro-real')
    await expect(linha).toBeVisible({ timeout: 15000 })
    const naTela = num(await linha.locator('span').nth(1).textContent())

    const entregues = await dbSelect<{ id: string }>('veic_venda', `company_id=eq.${DEMO_REVENDA}&situacao=eq.entregue&deleted_at=is.null&select=id`)
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const lucros: number[] = []
    for (const v of entregues) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_veic_venda_acerto`, { method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_venda_id: v.id }) })
      const j = (await r.json()) as { realizado?: { lucro_real?: number } }
      lucros.push(Number(j.realizado?.lucro_real))
    }
    expect(lucros.some((l) => Math.abs(l - naTela) < 0.01), `o lucro real da tela (${naTela}) é o calculado no banco`).toBe(true)
  })
})
