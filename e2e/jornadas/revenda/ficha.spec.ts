// Revenda R1b · Jornada FICHA / detalhes (V7 tela 4 · chamado #49 / R0.4).
// editar "detalhes" → salvar → recarregar → persiste; apagar → salvar → recarregar → persiste VAZIO.

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, veiculoIdPorModelo, registrarJornada } from '../../support/api'

test.describe('Ficha — detalhes gravam e limpam (#49)', () => {
  let veh = ''
  let versaoOriginal: string | null = null
  const VALOR = 'E2E VERSAO DEMO'

  // R1 item 1c: registra verde/vermelho — a jornada verde prova o requisito e prevalece sobre a foto.
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('ficha', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    veh = await veiculoIdPorModelo('Duster')
    const r = await dbSelect<{ versao: string | null }>('veic_veiculo', `id=eq.${veh}&select=versao`)
    versaoOriginal = r[0]?.versao ?? null
  })

  test.afterAll(async () => {
    await dbPatch('veic_veiculo', `id=eq.${veh}`, { versao: versaoOriginal })
  })

  test('editar a versão persiste; apagar persiste vazio (#49)', async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    // grava um valor no campo "versão" e salva
    const campo = page.locator('#campo-versao')
    await expect(campo).toBeVisible({ timeout: 20000 })
    await campo.fill(VALOR)
    await page.getByRole('button', { name: /^Salvar dados$/i }).click()
    await expect.poll(async () =>
      (await dbSelect<{ versao: string | null }>('veic_veiculo', `id=eq.${veh}&select=versao`))[0]?.versao,
      { timeout: 15000 }).toBe(VALOR)

    // recarrega → o valor persiste na tela
    await page.reload()
    await aguardarConteudo(page)
    await expect(page.locator('#campo-versao')).toHaveValue(VALOR)

    // APAGA (campo presente e vazio → grava NULL, o conserto do #49) e salva
    await page.locator('#campo-versao').fill('')
    await page.getByRole('button', { name: /^Salvar dados$/i }).click()
    await expect.poll(async () =>
      (await dbSelect<{ versao: string | null }>('veic_veiculo', `id=eq.${veh}&select=versao`))[0]?.versao,
      { timeout: 15000 }).toBeNull()

    // recarrega → o campo persiste VAZIO (não voltou o valor antigo)
    await page.reload()
    await aguardarConteudo(page)
    await expect(page.locator('#campo-versao')).toHaveValue('')
  })
})
