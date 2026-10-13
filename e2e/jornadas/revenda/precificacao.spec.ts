// Revenda R1b/R2 · Jornada PRECIFICAÇÃO (V8 tela 8 · fonte única R0.1 · Configuração da garagem R2).
// Fluxo R2: mudar a MARGEM na tela de Configuração → PRÉVIA obrigatória lista o efeito → confirmar →
// o preço mínimo muda IGUAL na ficha e na precificação (fn_veic_preco_minimo, fonte única).

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { DEMO_REVENDA, dbSelect, dbPatch, veiculoIdPorModelo, registrarJornada } from '../../support/api'

// lê o "R$ x.xxx,xx" que aparece logo após "Preço mínimo" (mesmo texto na ficha e na precificação)
async function precoMinimoNaTela(page: import('@playwright/test').Page): Promise<string | null> {
  const txt = await page.locator('body').innerText()
  const m = txt.match(/Preço mínimo[^R]*R\$\s*([\d.]+,\d{2})/)
  return m ? m[1] : null
}

test.describe('Precificação — margem única (via Configuração) propaga igual à ficha', () => {
  let veh = ''
  let margemOriginal: string | null = null
  const NOVA_MARGEM = '25'

  test.beforeAll(async () => {
    veh = await veiculoIdPorModelo('Onix 1.0')
    const cfg = await dbSelect<{ margem_alvo_pct: number | null }>('veic_config',
      `company_id=eq.${DEMO_REVENDA}&select=margem_alvo_pct`)
    margemOriginal = cfg[0]?.margem_alvo_pct != null ? String(cfg[0].margem_alvo_pct) : null
  })

  // R1 item 1c: registra verde/vermelho — a jornada verde prova o requisito e prevalece sobre a foto.
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('precificacao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    // restaura a margem da demo (o teardown global também reseta, mas devolvemos explicitamente)
    await dbPatch('veic_config', `company_id=eq.${DEMO_REVENDA}`,
      { margem_alvo_pct: margemOriginal != null ? Number(margemOriginal) : null })
  })

  test('mudar a margem na Configuração (com prévia) muda o preço mínimo igual na precificação e na ficha', async ({ page }) => {
    // 1) Configuração da garagem (R2): muda a margem alvo
    await page.goto('/dashboard/revenda/config')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    await page.getByLabel('Margem alvo %').fill(NOVA_MARGEM)

    // 2) PRÉVIA obrigatória: o botão abre o modal que lista o efeito antes de gravar
    await page.getByRole('button', { name: /Ver efeito e salvar/i }).click()
    await expect(page.getByText(/Efeito da mudança/i)).toBeVisible({ timeout: 20000 })
    await expect(page.getByText(/preço mínimo/i).first()).toBeVisible()

    // 3) confirma → grava; o banco confirma a nova margem
    await page.getByRole('button', { name: /Confirmar e salvar/i }).click()
    await expect.poll(async () => {
      const c = await dbSelect<{ margem_alvo_pct: number }>('veic_config',
        `company_id=eq.${DEMO_REVENDA}&select=margem_alvo_pct`)
      return c[0]?.margem_alvo_pct
    }, { timeout: 15000 }).toBe(Number(NOVA_MARGEM))

    // 4) precificação: o preço mínimo com a margem 25%
    await page.goto(`/dashboard/revenda/veiculo/${veh}/precificacao`)
    await aguardarConteudo(page)
    await expect(page.getByText(/Preço mínimo \(com margem 25%\)/)).toBeVisible({ timeout: 20000 })
    const precoPrecificacao = await precoMinimoNaTela(page)
    expect(precoPrecificacao, 'preço mínimo deve aparecer na precificação').not.toBeNull()

    // 5) ficha: o MESMO preço mínimo (fonte única) e a mesma margem
    await page.goto(`/dashboard/revenda/veiculo/${veh}`)
    await aguardarConteudo(page)
    await expect(page.getByText(/Preço mínimo \(margem 25%\)/)).toBeVisible({ timeout: 20000 })
    const precoFicha = await precoMinimoNaTela(page)
    expect(precoFicha, 'preço mínimo deve aparecer na ficha').not.toBeNull()

    expect(precoFicha, 'preço mínimo IGUAL na ficha e na precificação (fonte única)').toBe(precoPrecificacao)
  })
})
