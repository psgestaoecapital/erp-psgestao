// RD-78 · Aceitação da PR "ficha: KM, manual e chave reserva" (chamados Fábio/Alliance #26 #49 #143 · #101).
// E1) na ficha, KM + manual + chave reserva + especificação gravam (formato BR "85.000"), e potência/cilindradas
//     saíram da linha principal (ficam no bloco fiscal);
// E2) "Novo veículo" no Pátio: rótulos visíveis, aviso quando o modelo parece ano, e "72.956,00" grava 72956
//     (antes: Number("72.956,00") = NaN → o valor de aquisição sumia);
// E3) o cartão do Pátio mostra marca + modelo (antes só o modelo).
// Sempre na Demonstração Revenda; o global-teardown (fn_demo_reset) devolve a demo ao seed.

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, veiculoIdPorModelo, registrarJornada, DEMO_REVENDA } from '../../support/api'

type Ficha = { km_atual: number | null; tem_manual: boolean | null; tem_chave_reserva: boolean | null; observacao: string | null }

test.describe('Aceitação — ficha com KM, manual e chave reserva (#26 #49 #143 · #101)', () => {
  let veh = ''
  let original: Ficha | null = null
  const chassiNovo = `E2EKM${Date.now().toString().slice(-10)}`

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-ficha-km', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    veh = await veiculoIdPorModelo('Ka')
    original = (await dbSelect<Ficha>('veic_veiculo', `id=eq.${veh}&select=km_atual,tem_manual,tem_chave_reserva,observacao`))[0] ?? null
  })

  test.afterAll(async () => {
    if (original) await dbPatch('veic_veiculo', `id=eq.${veh}`, original)
    // o veículo criado pelo E2 sai do pátio da demo (soft delete); o fn_demo_reset do teardown também limpa
    await dbPatch('veic_veiculo', `company_id=eq.${DEMO_REVENDA}&chassi=eq.${chassiNovo}`, { deleted_at: new Date().toISOString() })
  })

  test('E1 · ficha grava KM "85.000", manual sim, chave reserva não e a especificação', async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    const km = page.locator('#campo-km_atual')
    await expect(km).toBeVisible({ timeout: 20000 })
    // potência e cilindradas não estão mais na linha principal: aparecem depois do título do bloco fiscal
    await expect(page.getByText(/Fiscal do veículo/)).toBeVisible()

    await km.fill('85.000')
    await page.locator('#campo-tem_manual').selectOption('sim')
    await page.locator('#campo-tem_chave_reserva').selectOption('nao')
    await page.locator('#campo-observacao').fill('E2E · único dono, revisões na concessionária')
    await page.getByRole('button', { name: /^Salvar dados$/i }).click()

    await expect.poll(async () => (await dbSelect<Ficha>('veic_veiculo', `id=eq.${veh}&select=km_atual,tem_manual,tem_chave_reserva,observacao`))[0],
      { timeout: 15000 }).toMatchObject({ tem_manual: true, tem_chave_reserva: false, observacao: 'E2E · único dono, revisões na concessionária' })
    const r = (await dbSelect<Ficha>('veic_veiculo', `id=eq.${veh}&select=km_atual`))[0]
    expect(Number(r?.km_atual)).toBe(85000)

    // sobrevive ao reload: os campos voltam preenchidos do banco
    await page.reload()
    await aguardarConteudo(page)
    await expect(page.locator('#campo-km_atual')).toHaveValue('85000', { timeout: 20000 })
    await expect(page.locator('#campo-tem_manual')).toHaveValue('sim')
    await expect(page.locator('#campo-tem_chave_reserva')).toHaveValue('nao')
  })

  test('E2 · Novo veículo: rótulos, aviso de ano no modelo e "72.956,00" grava 72956', async ({ page }) => {
    await page.goto('/dashboard/revenda/patio')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    await page.getByRole('button', { name: /\+ Novo veículo/ }).click()
    await expect(page.getByText('Chassi (obrigatório)')).toBeVisible({ timeout: 15000 })
    await page.getByPlaceholder('9BW…').fill(chassiNovo)
    await page.getByPlaceholder('ex.: Chevrolet').fill('Chevrolet')
    const modelo = page.getByPlaceholder('ex.: Onix, L200, CB 500')
    await modelo.fill('2009')
    await expect(page.getByText(/parece o ano/)).toBeVisible()
    await modelo.fill('Onix')
    await expect(page.getByText(/parece o ano/)).toHaveCount(0)
    await page.getByPlaceholder('ex.: 2021').fill('2021')
    await page.getByPlaceholder('ex.: 85.000').fill('85.000')
    await page.locator('label', { hasText: /^Manual/ }).locator('select').selectOption('sim')
    await page.getByPlaceholder('ex.: 72.956,00').fill('72.956,00')
    await page.getByRole('button', { name: /^Salvar$/ }).click()

    type Novo = { modelo: string; ano_modelo: number; valor_aquisicao: number; km_entrada: number; tem_manual: boolean | null }
    await expect.poll(async () => (await dbSelect<Novo>('veic_veiculo',
      `company_id=eq.${DEMO_REVENDA}&chassi=eq.${chassiNovo}&deleted_at=is.null&select=modelo,ano_modelo,valor_aquisicao,km_entrada,tem_manual`)).length,
      { timeout: 15000 }).toBe(1)
    const n = (await dbSelect<Novo>('veic_veiculo', `company_id=eq.${DEMO_REVENDA}&chassi=eq.${chassiNovo}&select=modelo,ano_modelo,valor_aquisicao,km_entrada,tem_manual`))[0]
    expect(n.modelo).toBe('Onix')
    expect(Number(n.ano_modelo)).toBe(2021)
    expect(Number(n.valor_aquisicao)).toBe(72956)
    expect(Number(n.km_entrada)).toBe(85000)
    expect(n.tem_manual).toBe(true)
  })

  test('E3 · cartão do Pátio mostra marca + modelo', async ({ page }) => {
    await page.goto('/dashboard/revenda/patio')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)
    await expect(page.getByText(/^Ford Ka\b/).first()).toBeVisible({ timeout: 20000 })
  })
})
