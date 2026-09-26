// RD-78 · Aceitação da PR "vistoria rápida: foto do reparo" (jornada vistoria vermelha em produção, linha 80).
// Causa provada (RD-81, simulação em rollback na Demo): no modo RÁPIDO nenhuma região tem foto obrigatória;
// fn_insp_vistoria_concluir bloqueia o item em reparo/troca sem foto devolvendo SÓ fotos_reparo_troca_faltando.
// A tela lia apenas fotos_faltando/gastos_faltando → "CONCLUIR VISTORIA" não fazia nada (bloqueio mudo) e,
// sem foto obrigatória na região, não havia campo para anexar a foto → a vistoria rápida com reparo nunca concluía.
// Aqui: reparo sem foto → a tela AVISA ("Falta para concluir" + link do item) e NÃO conclui; a região do
// reparo mostra o campo de foto; com a foto, conclui. Sempre na Demonstração Revenda.

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { DEMO_REVENDA, dbSelect, dbDelete, dbPatch, veiculoIdPorModelo, registrarJornada } from '../../support/api'

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

type Vist = { id: string; situacao: string }
async function vistoriasDo(veh: string): Promise<Vist[]> {
  return dbSelect<Vist>('insp_vistoria', `alvo_tabela=eq.veic_veiculo&alvo_id=eq.${veh}&select=id,situacao`)
}
async function limpar(veh: string): Promise<void> {
  for (const v of await vistoriasDo(veh)) {
    await dbDelete('insp_foto', `vistoria_id=eq.${v.id}`)
    await dbDelete('insp_resposta', `vistoria_id=eq.${v.id}`)
    await dbDelete('insp_vistoria', `id=eq.${v.id}`)
  }
}

test.describe.serial('Aceitação — vistoria rápida: reparo sem foto avisa, região mostra a foto, com foto conclui', () => {
  let veh = ''

  test.beforeAll(async () => {
    veh = await veiculoIdPorModelo('208')   // disponível e sem vistoria na demo (a jornada vistoria usa o Ka)
    await dbPatch('veic_config', `company_id=eq.${DEMO_REVENDA}`, { vistoria_modo_padrao: 'rapida' })
    await limpar(veh)
  })
  test.afterAll(async () => { await limpar(veh) })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-vistoria-rapida-foto', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('reparo sem foto: CONCLUIR avisa o que falta; com a foto da região, conclui', async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}/vistoria`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)
    await page.getByRole('button', { name: /Vistoria rápida/ }).click()
    await expect(page.getByText(/Vistoria rápida \(9 itens\)/)).toBeVisible({ timeout: 20000 })
    const vistId = (await vistoriasDo(veh))[0].id

    // 1º item (região 1) em REPARO com valor
    await page.getByRole('button', { name: /^reparo$/i }).click()
    await page.getByPlaceholder('ex.: Reparo tecido/couro').fill('Reparo aceitação (e2e)')
    await page.getByPlaceholder('R$ 0,00').fill('350')
    await page.getByRole('button', { name: /^salvar$/i }).click()
    await expect.poll(async () => (await dbSelect('insp_resposta', `vistoria_id=eq.${vistId}&estado=eq.reparo&select=id`)).length,
      { timeout: 15000 }).toBe(1)
    // a região do reparo agora tem onde anexar a foto (antes: nenhum campo no modo rápido)
    await expect(page.getByText(/Foto do reparo\/troca/)).toBeVisible()
    await expect(page.locator('input[type="file"]').first()).toBeAttached()

    // demais regiões OK até o resumo
    for (let i = 0; i < 14; i++) {
      if (await page.getByRole('button', { name: /CONCLUIR VISTORIA/i }).isVisible().catch(() => false)) break
      const ok = page.getByRole('button', { name: /^ok$/i })
      if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {})
      const avancar = page.getByRole('button', { name: /próxima região →|ir ao resumo →/i })
      if (await avancar.isEnabled().catch(() => false)) await avancar.click()
    }

    // sem foto: a tela AVISA (antes ficava muda) e a vistoria continua em andamento
    await page.getByRole('button', { name: /CONCLUIR VISTORIA/i }).click()
    await expect(page.getByText(/Falta para concluir/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/📷 Foto obrigatória/i)).toBeVisible()
    expect((await vistoriasDo(veh))[0].situacao).toBe('em_andamento')

    // o link leva à região do reparo; sobe a foto; conclui
    await page.getByText(/📷 Foto obrigatória/i).locator('xpath=following::button[1]').click()
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'reparo.png', mimeType: 'image/png', buffer: PNG_1x1 })
    await expect.poll(async () => (await dbSelect('insp_foto', `vistoria_id=eq.${vistId}&select=id`)).length, { timeout: 15000 }).toBeGreaterThan(0)
    for (let i = 0; i < 14; i++) {
      if (await page.getByRole('button', { name: /CONCLUIR VISTORIA/i }).isVisible().catch(() => false)) break
      const avancar = page.getByRole('button', { name: /próxima região →|ir ao resumo →/i })
      if (await avancar.isEnabled().catch(() => false)) await avancar.click()
    }
    await page.getByRole('button', { name: /CONCLUIR VISTORIA/i }).click()
    await expect.poll(async () => (await vistoriasDo(veh))[0]?.situacao, { timeout: 20000 }).toBe('concluida')
  })
})
