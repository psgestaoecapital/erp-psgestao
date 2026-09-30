// Tryo #263 · "ao inserir a nova oportunidade para a área de orçamento no kanban, a lista de orçamentos não está
// atualizando". Só o ARRASTAR para "Orçando" gerava o orçamento — e exigia cliente (que o #262 não gravava). Pelo
// seletor de Etapa do formulário o card ia para "Orçando" sem orçamento (Tryo: 12 em Orçando, 1 com orçamento).
// Agora salvar a oportunidade em "Orçando" gera o orçamento (RPC idempotente) e ele aparece na lista de Orçamentos.
// Demonstração Comércio (GE), nunca empresa real. Registros de teste desativados/cancelados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const CLIENTE = `Cliente 263 ${RUN}`
const DESCRICAO = `Orcando 263 ${RUN}`

test.describe('Oportunidade em "Orçando" gera o orçamento e ele aparece na lista (#263)', () => {
  let opId = ''
  let orcId = ''
  let cliId = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-tryo-263-orcando-gera-orcamento', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (opId) await dbPatch('erp_crm_oportunidade', `id=eq.${opId}`, { deleted_at: new Date().toISOString() })
    if (orcId) await dbPatch('erp_orcamentos', `id=eq.${orcId}`, { status: 'cancelado' })
    if (cliId) await dbPatch('erp_clientes', `id=eq.${cliId}`, { ativo: false })
  })

  test('criar a oportunidade já em "Orçando" gera o orçamento, que aparece na lista de Orçamentos', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/projetos/oportunidades')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: '+ Nova oportunidade' }).click()
    await page.getByTestId('oport-cliente').fill(CLIENTE)
    await page.getByTestId('oport-descricao').fill(DESCRICAO)
    await page.locator('select').filter({ has: page.locator('option[value="orcando"]') }).first().selectOption('orcando')
    await page.getByRole('button', { name: 'CRIAR', exact: true }).click()

    await expect.poll(async () => (await dbSelect<{ id: string; orcamento_id: string | null; cliente_id: string | null }>('erp_crm_oportunidade',
      `company_id=eq.${DEMO_COMERCIO}&titulo=eq.${encodeURIComponent(DESCRICAO.toUpperCase())}&select=id,orcamento_id,cliente_id`))[0]?.orcamento_id ?? null,
    { timeout: 20000, message: 'a oportunidade em "Orçando" ficou com o orçamento gerado' }).not.toBeNull()
    const [op] = await dbSelect<{ id: string; orcamento_id: string; cliente_id: string }>('erp_crm_oportunidade',
      `company_id=eq.${DEMO_COMERCIO}&titulo=eq.${encodeURIComponent(DESCRICAO.toUpperCase())}&select=id,orcamento_id,cliente_id`)
    opId = op.id; orcId = op.orcamento_id; cliId = op.cliente_id
    const [orc] = await dbSelect<{ numero: string; cliente_nome: string; status: string }>('erp_orcamentos', `id=eq.${orcId}&select=numero,cliente_nome,status`)
    expect(orc.cliente_nome, 'o orçamento nasce com o cliente da oportunidade').toBe(CLIENTE.toUpperCase())

    await page.goto('/dashboard/orcamentos')
    await aguardarConteudo(page)
    await expect(page.getByText(orc.numero, { exact: true }).first(), 'o orçamento aparece na lista de Orçamentos').toBeVisible({ timeout: 20000 })
  })
})
