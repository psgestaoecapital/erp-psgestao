// Revenda R1b · Jornada VENDAS E ENTREGA (V7 tela 10 / trava R0.2 + selo demo R0.2b).
// Civic (sem NF, aberta) NÃO tem botão de entrega; HB20 (demo, faturada) entrega COM o selo; banco registra.

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { DEMO_REVENDA, dbSelect, dbPatch, veiculoIdPorModelo, registrarJornada } from '../../support/api'

async function vendaDoVeiculo(veh: string): Promise<{ id: string; situacao: string }> {
  const r = await dbSelect<{ id: string; situacao: string }>('veic_venda',
    `veiculo_id=eq.${veh}&deleted_at=is.null&select=id,situacao&limit=1`)
  if (!r.length) throw new Error(`venda demo do veículo ${veh} não encontrada`)
  return r[0]
}

test.describe('Vendas — entrega só com NF ou demo (com selo)', () => {
  let hb20Venda = ''
  let civicVenda = ''

  // R1 item 1c: registra verde/vermelho (jornada verde prova o requisito e prevalece sobre a foto).
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('vendas', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const hb20 = await veiculoIdPorModelo('HB20')
    const civic = await veiculoIdPorModelo('Civic EXL')
    hb20Venda = (await vendaDoVeiculo(hb20)).id
    civicVenda = (await vendaDoVeiculo(civic)).id
    // precondição idempotente: HB20 faturada (entrega demo), Civic aberta (sem NF, sem entrega)
    await dbPatch('veic_venda', `id=eq.${hb20Venda}`, { situacao: 'faturada' })
    await dbPatch('veic_venda', `id=eq.${civicVenda}`, { situacao: 'aberta' })
  })

  test('Civic sem botão de entrega; HB20 entrega com selo e o banco registra', async ({ page }) => {
    await page.goto('/dashboard/revenda/vendas')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    // Civic (aberta, sem NF) → aviso "Emitir nota antes de entregar", sem botão de entrega
    await expect(page.getByText(/Emitir nota antes de entregar/i).first()).toBeVisible({ timeout: 20000 })
    // HB20 (demo, faturada) → selo de demonstração + botão de entrega
    await expect(page.getByText(/Demonstração — sem nota fiscal real/i).first()).toBeVisible()
    const entregar = page.getByRole('button', { name: /marcar entregue/i })
    await expect(entregar.first()).toBeVisible()

    // entrega o HB20 (único faturado/demo → único botão)
    await entregar.first().click()
    await expect.poll(async () => (await dbSelect<{ situacao: string }>('veic_venda',
      `id=eq.${hb20Venda}&select=situacao`))[0]?.situacao, { timeout: 20000 }).toBe('entregue')

    // registro do selo em audit_log_global (entrega demo sem nota real)
    const audit = await dbSelect('audit_log_global',
      `registro_id=eq.${hb20Venda}&acao=eq.entrega_demo_sem_nota&select=id`)
    expect(audit.length, 'a entrega demo sem nota fica registrada em audit_log_global').toBeGreaterThan(0)

    // o banco registra (recebimento do banco na venda)
    const v = await dbSelect<{ total_banco: number }>('v_veic_venda',
      `id=eq.${hb20Venda}&select=total_banco`)
    expect(Number(v[0]?.total_banco) || 0, 'o banco deve aparecer como devedor na venda').toBeGreaterThan(0)
    expect(DEMO_REVENDA).toBe('b0700000-0000-4000-a000-000000000003')
  })
})
