// HB0 [celular] (auditor_pdca_g 24/10) — o cabeçalho do shell cabe no celular de 390px: a página não rola de lado
// (antes alargava para 404px) e o "Sair" fica inteiro dentro da tela. Vale nas 3 telas apontadas. Só leitura, DEMO Construtora.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000006'
const ROTAS = ['/dashboard/projetos/viagens', '/dashboard/projetos/tabelas-preco', '/dashboard/projetos/calculadora']

test.describe('HB0 — shell no celular', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb0-shell-celular', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  for (const rota of ROTAS) {
    test(`cabeçalho cabe na tela em ${rota}`, async ({ page }) => {
      await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
      await page.goto(rota)
      await aguardarConteudo(page)
      const sair = page.getByTestId('header-logout')
      await expect(sair).toBeVisible({ timeout: 30000 })

      const larguraTela = page.viewportSize()?.width ?? 0
      const caixa = await sair.boundingBox()
      expect(caixa).not.toBeNull()
      expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(larguraTela)

      const cabecalho = await page.getByTestId('topnav').evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(cabecalho).toBeLessThanOrEqual(1)
      const rolagem = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(rolagem).toBeLessThanOrEqual(1)
    })
  }
})
