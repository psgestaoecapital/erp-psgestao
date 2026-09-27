// #75 · PRINTS da Matriz de Conformidade na Demonstração Indústria (SST), celular (390) e computador (1440).
// PR descartável: roda no preview (login do robô), imprime as imagens em base64 no log para o CEO avaliar o layout.
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
    const buf = await page.screenshot({ type: 'jpeg', quality: 55 })
    const b64 = buf.toString('base64')
    const partes = Math.ceil(b64.length / 3000)
    for (let i = 0; i < partes; i++) console.log(`PRINT75|${nome}|${i + 1}/${partes}|${b64.slice(i * 3000, (i + 1) * 3000)}`)
    console.log(`PRINT75|${nome}|fim|${buf.length} bytes`)
  }
})
