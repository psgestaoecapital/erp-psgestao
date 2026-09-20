// Revenda R1b · Jornada PRECIFICAÇÃO (V7 tela 8 / fonte única R0.1).
// mudar a margem na config → o preço mínimo muda IGUAL na ficha e na precificação (fn_veic_preco_minimo).

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { DEMO_REVENDA, dbSelect, dbPatch, veiculoIdPorModelo } from '../../support/api'

// lê o "R$ x.xxx,xx" que aparece logo após "Preço mínimo" (mesmo texto na ficha e na precificação)
async function precoMinimoNaTela(page: import('@playwright/test').Page): Promise<string | null> {
  const txt = await page.locator('body').innerText()
  const m = txt.match(/Preço mínimo[^R]*R\$\s*([\d.]+,\d{2})/)
  return m ? m[1] : null
}

test.describe('Precificação — margem única propaga igual à ficha', () => {
  let veh = ''
  let margemOriginal: string | null = null
  const NOVA_MARGEM = '25'

  test.beforeAll(async () => {
    veh = await veiculoIdPorModelo('Onix 1.0')
    const cfg = await dbSelect<{ margem_alvo_pct: number | null }>('veic_config',
      `company_id=eq.${DEMO_REVENDA}&select=margem_alvo_pct`)
    margemOriginal = cfg[0]?.margem_alvo_pct != null ? String(cfg[0].margem_alvo_pct) : null
  })

  test.afterAll(async () => {
    // restaura a margem da demo (o teardown global também reseta, mas devolvemos explicitamente)
    await dbPatch('veic_config', `company_id=eq.${DEMO_REVENDA}`,
      { margem_alvo_pct: margemOriginal != null ? Number(margemOriginal) : null })
  })

  test('mudar a margem na config muda o preço mínimo igual na precificação e na ficha', async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}/precificacao`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    // abre o painel de encargos e muda a margem alvo
    await page.getByRole('button', { name: /configurar encargos da loja/i }).click()
    await page.getByLabel('Margem alvo %').fill(NOVA_MARGEM)
    await page.getByRole('button', { name: /Salvar encargos/i }).click()

    // banco confirma a nova margem
    await expect.poll(async () => {
      const c = await dbSelect<{ margem_alvo_pct: number }>('veic_config',
        `company_id=eq.${DEMO_REVENDA}&select=margem_alvo_pct`)
      return c[0]?.margem_alvo_pct
    }, { timeout: 15000 }).toBe(Number(NOVA_MARGEM))

    // precificação: recarrega e lê o preço mínimo com a margem 25%
    await page.reload()
    await aguardarConteudo(page)
    await expect(page.getByText(/Preço mínimo \(com margem 25%\)/)).toBeVisible({ timeout: 20000 })
    const precoPrecificacao = await precoMinimoNaTela(page)
    expect(precoPrecificacao, 'preço mínimo deve aparecer na precificação').not.toBeNull()

    // ficha: o mesmo preço mínimo (fonte única) e a mesma margem
    await page.goto(`/dashboard/revenda/veiculo/${veh}`)
    await aguardarConteudo(page)
    await expect(page.getByText(/Preço mínimo \(margem 25%\)/)).toBeVisible({ timeout: 20000 })
    const precoFicha = await precoMinimoNaTela(page)
    expect(precoFicha, 'preço mínimo deve aparecer na ficha').not.toBeNull()

    expect(precoFicha, 'preço mínimo IGUAL na ficha e na precificação (fonte única)').toBe(precoPrecificacao)
  })
})
