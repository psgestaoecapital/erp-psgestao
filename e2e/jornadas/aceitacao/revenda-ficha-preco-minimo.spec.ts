// RD-78 · Aceitação da PR "ficha mostra o preço mínimo com as mesmas palavras da precificação" (jornada precificacao).
// Causa do vermelho em produção: o rótulo do card da ficha tinha text-transform: uppercase, e a jornada lê o texto
// RENDERIZADO (innerText = "PREÇO MÍNIMO (MARGEM 25%)") — o "Preço mínimo … R$" nunca era achado (null).
// Aqui a ficha é lida exatamente como a jornada precificacao lê (mesmo helper, mesma regex), sem mexer na config:
// o preço mínimo aparece na ficha, com a mesma margem e o MESMO valor da tela de precificação (fonte única).
// Sempre na Demonstração Revenda (somente leitura).

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { veiculoIdPorModelo, registrarJornada } from '../../support/api'

// cópia literal do helper de e2e/jornadas/revenda/precificacao.spec.ts
async function precoMinimoNaTela(page: import('@playwright/test').Page): Promise<string | null> {
  const txt = await page.locator('body').innerText()
  const m = txt.match(/Preço mínimo[^R]*R\$\s*([\d.]+,\d{2})/)
  return m ? m[1] : null
}

test.describe('Aceitação — ficha mostra o preço mínimo igual à precificação (jornada precificacao)', () => {
  let veh = ''

  test.beforeAll(async () => { veh = await veiculoIdPorModelo('Onix 1.0') })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-ficha-preco-minimo', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('preço mínimo legível na ficha, mesma margem e mesmo valor da precificação', async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}/precificacao`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)
    const rotuloPrec = page.getByText(/Preço mínimo \(com margem \d+(\.\d+)?%\)/)
    await expect(rotuloPrec).toBeVisible({ timeout: 20000 })
    const margem = (await rotuloPrec.innerText()).match(/margem (\d+(\.\d+)?)%/)?.[1]
    const precoPrecificacao = await precoMinimoNaTela(page)
    expect(precoPrecificacao, 'preço mínimo deve aparecer na precificação').not.toBeNull()

    await page.goto(`/dashboard/revenda/veiculo/${veh}`)
    await aguardarConteudo(page)
    await expect(page.getByText(new RegExp(`Preço mínimo \\(margem ${margem}%\\)`))).toBeVisible({ timeout: 20000 })
    const precoFicha = await precoMinimoNaTela(page)
    expect(precoFicha, 'preço mínimo deve aparecer na ficha').not.toBeNull()
    expect(precoFicha, 'preço mínimo IGUAL na ficha e na precificação (fonte única)').toBe(precoPrecificacao)
  })
})
