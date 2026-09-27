// #75 · PRINTS da Matriz de Conformidade na Demonstração Indústria (SST), celular (390) e computador (1440).
// PR descartável: roda no preview (login do robô), salva os PNG no artefato aceitacao-diagnostico-host para o CEO avaliar o layout.
// Não é mergeada. Só leitura; só a demonstração.

import { test, expect, aguardarConteudo } from '../../support/fixtures'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'

test('prints da Matriz de Conformidade (demo SST) — celular e computador', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
  for (const [nome, largura, altura] of [['celular', 390, 844], ['computador', 1440, 900]] as const) {
    await page.setViewportSize({ width: largura, height: altura })
    await page.goto('/dashboard/compliance/matriz')
    await aguardarConteudo(page)
    await expect(page.getByText('Ana Paula Demo').first()).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1500)
    // pasta que o aceitacao-pr.yml SEMPRE sobe como artefato (aceitacao-diagnostico-host)
    await page.screenshot({ path: `e2e/diagnostico-host/prints-75-matriz-${nome}.png`, fullPage: false })
    console.log(`PRINT75|${nome}|salvo em e2e/diagnostico-host/prints-75-matriz-${nome}.png`)
  }
})
