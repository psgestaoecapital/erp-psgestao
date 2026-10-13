// RD-78 · Aceitação da PR "consignado: só valor de venda" (chamado Fábio/Alliance #115).
// "CAMPO CONSIGNADO — NÃO PRECISA PRECIFICAÇÃO APENAS VALOR DE VENDA": carro consignado (origem = 'consignacao')
// não tem custo de aquisição — a loja só define o valor de venda.
// E1) ficha do consignado: sem o aviso "Sem custo de aquisição", sem "preço mínimo / informe a aquisição",
//     com o chip neutro "consignado" e o card "Valor de venda";
// E2) @pos-migration · precificação do consignado = só o valor de venda; salvar grava preco_venda e deixa
//     preco_minimo e margem_alvo_pct NULL (antes gravava piso R$ 0,00) — depende da migration 20260926240000;
// E3) Pátio: o consignado aparece com o chip "consignado", sem o aviso "sem custo de aquisição".
// Sempre na Demonstração Revenda (Duster consignado do seed); o afterAll devolve preço/histórico ao estado anterior.

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, dbDelete, veiculoIdPorModelo, registrarJornada } from '../../support/api'

type Preco = { origem: string | null; preco_venda: number | null; preco_minimo: number | null; margem_alvo_pct: number | null; precificado_em: string | null; precificado_por: string | null }
const COLS = 'origem,preco_venda,preco_minimo,margem_alvo_pct,precificado_em,precificado_por'
const OBS = 'E2E #115 · consignado só valor de venda'

test.describe('Aceitação — consignado: só valor de venda (#115)', () => {
  let veh = ''
  let original: Preco | null = null

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-consignado-115', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    veh = await veiculoIdPorModelo('Duster')
    original = (await dbSelect<Preco>('veic_veiculo', `id=eq.${veh}&select=${COLS}`))[0] ?? null
    expect(original?.origem, 'o Duster da demo precisa ser consignado').toBe('consignacao')
  })

  test.afterAll(async () => {
    if (original) {
      await dbPatch('veic_veiculo', `id=eq.${veh}`, {
        preco_venda: original.preco_venda, preco_minimo: original.preco_minimo, margem_alvo_pct: original.margem_alvo_pct,
        precificado_em: original.precificado_em, precificado_por: original.precificado_por,
      })
    }
    await dbDelete('veic_precificacao_hist', `veiculo_id=eq.${veh}&observacao=eq.${encodeURIComponent(OBS)}`)
  })

  test('E1 · ficha do consignado: chip "consignado", sem aviso de custo de aquisição nem preço mínimo', async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    await expect(page.getByTestId('chip-consignado')).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Valor de venda').first()).toBeVisible()
    await expect(page.getByText(/Sem custo de aquisição/)).toHaveCount(0)
    await expect(page.getByText(/informe a aquisição/)).toHaveCount(0)
    await expect(page.getByText(/Posso vender no mínimo/)).toHaveCount(0)
  })

  // @pos-migration: o preco_minimo NULL depende da migration 20260926240000, que só chega ao banco no merge. No preview
  // da PR roda em modo informativo; o veredito é o job aceitacao-pos-migration, em produção, logo após o deploy.
  test('E2 · precificação do consignado: só valor de venda; grava preco_venda e preco_minimo NULL', { tag: '@pos-migration' }, async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}/precificacao`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    const campo = page.getByLabel('Valor de venda')
    await expect(campo).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('chip-consignado')).toBeVisible()
    // nada da conta de carro comprado: custo, piso, preço mínimo, margem, teto de compra
    await expect(page.getByText(/Preço mínimo|Piso sem margem|Teto de compra|Margem projetada|O que este carro já custou/)).toHaveCount(0)

    await campo.fill('79500')
    await page.getByPlaceholder('observação (opcional)').fill(OBS)
    await page.getByRole('button', { name: /SALVAR VALOR DE VENDA/ }).click()

    await expect.poll(async () => {
      const r = (await dbSelect<Preco>('veic_veiculo', `id=eq.${veh}&select=${COLS}`))[0]
      return { preco_venda: r?.preco_venda != null ? Number(r.preco_venda) : null, preco_minimo: r?.preco_minimo ?? null, margem_alvo_pct: r?.margem_alvo_pct ?? null }
    }, { timeout: 15000 }).toEqual({ preco_venda: 79500, preco_minimo: null, margem_alvo_pct: null })

    const h = await dbSelect<{ preco_venda: number; preco_minimo: number | null }>('veic_precificacao_hist',
      `veiculo_id=eq.${veh}&observacao=eq.${encodeURIComponent(OBS)}&select=preco_venda,preco_minimo`)
    expect(h.length).toBe(1)
    expect(Number(h[0].preco_venda)).toBe(79500)
    expect(h[0].preco_minimo).toBeNull()
  })

  test('E3 · Pátio: consignado com chip, sem aviso de custo de aquisição', async ({ page }) => {
    await page.goto('/dashboard/revenda/patio')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    await expect(page.getByText(/Duster/).first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('consignado', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/sem custo de aquisição — margem não calcula/)).toHaveCount(0)
  })
})
