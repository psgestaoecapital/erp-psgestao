// Revenda R4b · Jornada VENDAS E ENTREGA (Tela 10). Fluxo novo: "Entregar" abre o checklist
// (obrigatórios travam), conclui a entrega; termo + acerto previsto × realizado; títulos na GE visíveis.
// Civic (sem NF, aberta) NÃO entrega; HB20 (demo, faturada) entrega pelo checklist com selo; banco registra.

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { DEMO_REVENDA, dbSelect, dbPatch, veiculoIdPorModelo, registrarJornada } from '../../support/api'

async function vendaDoVeiculo(veh: string): Promise<{ id: string; situacao: string }> {
  const r = await dbSelect<{ id: string; situacao: string }>('veic_venda',
    `veiculo_id=eq.${veh}&deleted_at=is.null&select=id,situacao&limit=1`)
  if (!r.length) throw new Error(`venda demo do veículo ${veh} não encontrada`)
  return r[0]
}

test.describe('Vendas e entrega — checklist, títulos na GE e acerto', () => {
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

  test('HB20 entrega pelo checklist (obrigatórios) com selo; banco e títulos na GE aparecem', async ({ page }) => {
    await page.goto('/dashboard/revenda/vendas')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    // Civic (aberta, sem NF) → aviso "Emitir nota antes de entregar"
    await expect(page.getByText(/Emitir nota antes de entregar/i).first()).toBeVisible({ timeout: 20000 })
    // HB20 (demo, faturada) → selo + botão "Entregar"
    await expect(page.getByText(/Demonstração — sem nota fiscal real/i).first()).toBeVisible()
    // Títulos na GE (rastreabilidade recebimento ↔ erp_receber) visíveis na tela
    await expect(page.getByText(/Títulos no financeiro \(GE\)/i).first()).toBeVisible()
    await expect(page.getByText(/título GE/i).first()).toBeVisible()

    // abre o checklist da entrega
    await page.getByRole('button', { name: /^Entregar$/ }).first().click()
    await expect(page.getByText(/Marque os itens conferidos/i)).toBeVisible({ timeout: 15000 })
    // marca todos os itens do checklist (garante os obrigatórios)
    const boxes = page.locator('input[type="checkbox"]')
    const n = await boxes.count()
    for (let i = 0; i < n; i++) { const b = boxes.nth(i); if (!(await b.isChecked())) await b.check() }
    await page.getByPlaceholder(/ex\.: 71000/).fill('71500')
    await page.getByRole('button', { name: /Concluir entrega/i }).click()

    await expect.poll(async () => (await dbSelect<{ situacao: string }>('veic_venda',
      `id=eq.${hb20Venda}&select=situacao`))[0]?.situacao, { timeout: 20000 }).toBe('entregue')

    // selo em audit_log_global (entrega demo sem nota real)
    const audit = await dbSelect('audit_log_global',
      `registro_id=eq.${hb20Venda}&acao=eq.entrega_demo_sem_nota&select=id`)
    expect(audit.length, 'a entrega demo sem nota fica registrada em audit_log_global').toBeGreaterThan(0)

    // o banco registra (recebimento do banco na venda)
    const v = await dbSelect<{ total_banco: number }>('v_veic_venda', `id=eq.${hb20Venda}&select=total_banco`)
    expect(Number(v[0]?.total_banco) || 0, 'o banco deve aparecer como devedor na venda').toBeGreaterThan(0)
    expect(DEMO_REVENDA).toBe('b0700000-0000-4000-a000-000000000003')
  })

  test('acerto_previsto_realizado — a venda entregue mostra previsto × realizado', async ({ page }) => {
    await page.goto('/dashboard/revenda/vendas')
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    // abre o acerto de contas de uma venda entregue (Compass é entregue no seed)
    const acerto = page.getByRole('button', { name: /Acerto de contas/i })
    await expect(acerto.first()).toBeVisible({ timeout: 20000 })
    await acerto.first().click()

    // modal com as duas colunas e o lucro dos dois lados
    await expect(page.getByText(/^Previsto$/).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/^Realizado$/).first()).toBeVisible()
    await expect(page.getByText(/Lucro projetado/i).first()).toBeVisible()
    await expect(page.getByText(/Lucro real/i).first()).toBeVisible()
    await expect(page.getByText(/Em aberto — banco/i).first()).toBeVisible()
  })
})
