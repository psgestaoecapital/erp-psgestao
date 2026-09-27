// #35 (FC Pisos · Jordana) · "faturar por MEDIÇÃO, com a opção de gerar ou não o financeiro". No pedido
// (Vender e Faturar) com 2+ parcelas, o card "Medições" deixa marcar parcelas e emitir UMA NFS-e pela soma.
// A emissão manda ao servidor as parcelas + se gera o financeiro; o banco valida (fn_nfse_medicao_validar) e,
// autorizada a nota, efetiva só essas parcelas (migration 20260927200000).
// 1º teste (caminho principal · roda no preview): marcar a parcela 1 → modal da medição com o valor travado na
//    soma → a emissão sai pelo valor das parcelas, com as parcelas e "gerar financeiro" escolhido. A demo não
//    emite nota real (trava de ambiente): a chamada à prefeitura é interceptada e só o PEDIDO é conferido.
// 2º teste (@pos-migration): a validação do banco aceita a soma certa e recusa a errada.
// Demonstração Comércio (GE); pedido de teste criado e removido no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, rpc, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${Date.now().toString(36)}`
const CLIENTE = `Obra medição ${RUN}`
let pedidoId = ''
const parcelas: string[] = []

test.describe('Vender e Faturar — NFS-e por medição (#35)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    pedidoId = (await dbInsert<{ id: string }>('erp_pedidos', {
      company_id: DEMO_GE, numero: `MED-${RUN}`, cliente_nome: CLIENTE, cliente_cnpj: '11222333000181',
      status: 'aberto', subtotal: 1000, total: 1000,
    })).id
    await dbInsert('erp_pedidos_itens', {
      company_id: DEMO_GE, pedido_id: pedidoId, tipo_item: 'servico', servico_descricao: 'Assentamento de piso (medição)',
      quantidade: 1, preco_unitario: 1000, subtotal: 1000,
    })
    for (const [n, valor, dias] of [[1, 400, 10], [2, 600, 40]] as const) {
      const venc = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10)
      const p = await dbInsert<{ id: string }>('erp_pedidos_parcelas', { company_id: DEMO_GE, pedido_id: pedidoId, numero: n, valor, vencimento: venc })
      parcelas.push(p.id)
      await dbInsert('erp_receber', {
        company_id: DEMO_GE, descricao: `Pedido MED-${RUN} - parcela ${n}`, valor, data_vencimento: venc,
        status: 'previsto', pedido_id: pedidoId, pedido_parcela_id: p.id, cliente_nome: CLIENTE,
      })
    }
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-35-nfse-medicao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (!pedidoId) return
    await dbDelete('erp_receber', `pedido_id=eq.${pedidoId}`)
      .catch(() => dbPatch('erp_receber', `pedido_id=eq.${pedidoId}`, { deleted_at: new Date().toISOString() }).catch(() => {}))
    await dbDelete('erp_pedidos_parcelas', `pedido_id=eq.${pedidoId}`).catch(() => {})
    await dbDelete('erp_pedidos_itens', `pedido_id=eq.${pedidoId}`).catch(() => {})
    await dbDelete('erp_pedidos', `id=eq.${pedidoId}`).catch(() => {})
  })

  test('marcar a parcela 1 → a NFS-e sai pelo valor dela, com as parcelas e sem gerar o financeiro', async ({ page }) => {
    // a demo não tem emissor fiscal (e não emite de verdade): simula o emissor ativo e intercepta a emissão
    await page.route(/\/rest\/v1\/erp_fiscal_provider_config\?.*ativo=eq\.true/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/vnd.pgrst.object+json', body: JSON.stringify({ provider: 'focusnfe', opcao_simples_nacional: 1 }) }))
    let corpo: Record<string, unknown> | null = null
    await page.route('**/api/fiscal/nfse/emitir', async (route) => {
      corpo = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'processando', providerReference: `e2e-35-${RUN}` }) })
    })

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/commerce/otc')
    await aguardarConteudo(page)
    await page.getByText(CLIENTE).first().click()

    const card = page.getByTestId('medicoes-card')
    await expect(card, 'pedido com 2 parcelas mostra o card de medições').toBeVisible({ timeout: 20000 })
    await expect(card.getByTestId('medicao-parcela')).toHaveCount(2)
    await card.getByTestId('medicao-parcela').filter({ hasText: 'Parcela 1' }).locator('input[type=checkbox]').check()
    await expect(page.getByTestId('medicao-emitir')).toContainText(/400,00/)
    await page.getByTestId('medicao-emitir').click()

    const modal = page.getByTestId('nfse-emitir-modal')
    await expect(modal.getByRole('heading', { name: 'Emitir NFS-e da medição' })).toBeVisible({ timeout: 15000 })
    await expect(modal.getByTestId('nfse-valor'), 'valor travado na soma das parcelas').toHaveValue('400,00')
    await expect(modal.getByTestId('nfse-valor')).toHaveAttribute('readonly', '')
    const gerar = modal.getByTestId('nfse-medicao-gerar-financeiro')
    await expect(gerar, 'padrão: gera o financeiro na autorização').toBeChecked()
    await gerar.uncheck()
    await modal.getByTestId('nfse-emitir-submit').click()

    await expect.poll(() => corpo, { timeout: 15000 }).not.toBeNull()
    const c = corpo as unknown as { medicao?: { pedidoId: string; parcelaIds: string[]; gerarFinanceiro: boolean }; manual?: { valorServicos: number }; erpReceberId?: string }
    expect(c.medicao, 'a emissão leva a medição').toEqual({ pedidoId, parcelaIds: [parcelas[0]], gerarFinanceiro: false })
    expect(c.manual?.valorServicos, 'nota pelo valor da parcela, não do pedido').toBe(400)
    expect(c.erpReceberId, 'não emite "por título": o título da parcela é só previsto').toBeUndefined()
  })

  test('o banco valida a medição: soma certa passa, soma errada é recusada @pos-migration', async () => {
    const ok = await rpc<{ ok: boolean }>('fn_nfse_medicao_validar', { p_company_id: DEMO_GE, p_pedido_id: pedidoId, p_parcela_ids: [parcelas[0]], p_valor: 400 })
    expect(ok.ok).toBe(true)
    const errado = await rpc<{ ok: boolean; erro: string }>('fn_nfse_medicao_validar', { p_company_id: DEMO_GE, p_pedido_id: pedidoId, p_parcela_ids: [parcelas[0]], p_valor: 1000 })
    expect(errado.ok).toBe(false)
    expect(errado.erro).toMatch(/somam R\$ 400\.00/)
    const duas = await rpc<{ ok: boolean }>('fn_nfse_medicao_validar', { p_company_id: DEMO_GE, p_pedido_id: pedidoId, p_parcela_ids: parcelas, p_valor: 1000 })
    expect(duas.ok, 'as duas parcelas juntas = R$ 1.000').toBe(true)
  })
})
