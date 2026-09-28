// CEO 28/09: o coletor antigo (Node + .env) sai do ar. Ele ficava público em /downloads/atak/* e era oferecido na tela
// Conectores ("Avançado — arquivos separados"). Não tinha chave dentro (conferido), mas chamava fn_atak_mapa_coletor,
// que está fechada desde a PR A — quem baixasse ficaria com um coletor que não funciona. O caminho oficial é o
// instalador .zip gerado na tela (link assinado de 10 min).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'

test.describe('Coletor antigo fora do ar', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-coletor-antigo-fora-do-ar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('arquivos do coletor antigo não são mais servidos', async ({ request }) => {
    for (const arq of ['collector.js', 'package.json', 'README.md', 'INSTALACAO.md']) {
      const r = await request.get(`/downloads/atak/${arq}`)
      expect(r.status(), `/downloads/atak/${arq}`).toBe(404)
    }
  })

  test('caminho principal: tela Conectores abre e não oferece mais o modelo antigo', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto('/dashboard/industrial/conectores')
    await aguardarConteudo(page)
    // o título da página (no celular, o menu fechado também tem um item "Conectores" escondido — não serve de âncora)
    await expect(page.getByRole('heading', { name: /Conectores \(ERPs\)/ })).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Avançado — arquivos separados')).toHaveCount(0)
    await expect(page.locator('a[href^="/downloads/atak/"]')).toHaveCount(0)
  })
})
