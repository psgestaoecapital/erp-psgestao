// #339 (R.R · Rodrigo) · no card "NFS-e do serviço" (pedido de 1 parcela) a pessoa não via nenhuma seção de retenções
// antes de emitir. Causa provada (28/09): o card abre o MESMO NFSeEmitirGovModal da medição, mas a conferência só
// aparecia quando o cadastro do serviço retinha algo — e o único serviço da R.R (07.02) não retém nada; além disso o
// modal deixava emitir SEM serviço do cadastro (a nota sairia sem retenção, calada). Agora: com serviço, a conferência
// aparece SEMPRE (inclusive "nenhuma retenção"); sem serviço, não emite (a rota também recusa — gate de build).
// Emissão avulsa (/dashboard/fiscal/nfse) = o mesmo modal sem medição, que é o caso do pedido de 1 parcela.
// Demonstração Comércio (GE); serviço de teste criado e removido no fim. Nenhuma nota real: a emissão é interceptada.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36)
const DESC = `E2E 339 sem retencao ${RUN}`
const criados: string[] = []

async function abrirModal(page: import('@playwright/test').Page) {
  await page.route(/\/rest\/v1\/erp_fiscal_provider_config\?.*ativo=eq\.true/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/vnd.pgrst.object+json', body: JSON.stringify({ provider: 'focusnfe', opcao_simples_nacional: 1 }) }))
  await page.route(/\/rest\/v1\/rpc\/fn_nfse_validar_emissao/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pode_emitir: true, bloqueios: [] }) }))
  const envios: Record<string, unknown>[] = []
  await page.route('**/api/fiscal/nfse/emitir', async (route) => {
    envios.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, status: 'autorizada', numero: '997', nfseId: '00000000-0000-4000-a000-000000000339', providerReference: `e2e-339-${RUN}`, retencoesFederais: null,
    }) })
  })
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
  await page.goto('/dashboard/fiscal/nfse')
  await aguardarConteudo(page)
  await page.getByTestId('nfse-nova').click()
  const modal = page.getByTestId('nfse-emitir-modal')
  await expect(modal.getByTestId('nfse-servico-select')).toBeVisible({ timeout: 20000 })
  await modal.getByTestId('nfse-tomador-doc').fill('11222333000181')
  return { modal, envios }
}

test.describe('#339 · NFS-e de 1 parcela: conferência das retenções sempre visível e nunca sem serviço', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const r = await dbInsert<{ id: string }>('erp_servicos', {
      company_id: DEMO_GE, ativo: true, valor_unitario: 1000, codigo_servico_municipio: '070201', codigo_lc116: '07.02',
      codigo: `T${RUN}`, descricao_resumida: DESC,
    })
    criados.push(r.id)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-339-nfse-retencoes-parcela-unica', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { for (const id of criados) await dbDelete('erp_servicos', `id=eq.${id}`).catch(() => {}) })

  test('caminho principal: serviço sem retenção mostra "nenhuma retenção" para conferir antes de emitir', async ({ page }) => {
    const { modal, envios } = await abrirModal(page)
    const sel = modal.getByTestId('nfse-servico-select')
    const valor = await sel.locator('option', { hasText: DESC }).getAttribute('value')
    expect(valor, 'o serviço de teste aparece na lista').toBeTruthy()
    await sel.selectOption(valor!)
    const nenhuma = modal.getByTestId('nfse-retencoes-previa-nenhuma')
    await expect(nenhuma, 'a conferência das retenções aparece mesmo sem retenção no cadastro').toBeVisible({ timeout: 15000 })
    await expect(nenhuma).toContainText('Nenhuma retenção no cadastro deste serviço')
    await expect(modal.getByTestId('nfse-exige-servico')).toHaveCount(0)
    await expect(modal.getByTestId('nfse-emitir-submit')).toBeEnabled()
    await modal.getByTestId('nfse-emitir-submit').click()
    await expect.poll(() => envios.length, { timeout: 15000 }).toBe(1)
    expect(envios[0].servicoId, 'a nota sai do serviço do cadastro').toBe(valor)
  })

  test('sem serviço do cadastro não emite: aviso na tela e botão travado', async ({ page }) => {
    const { modal, envios } = await abrirModal(page)
    await expect(modal.getByTestId('nfse-exige-servico'), 'o modal diz por que não emite').toBeVisible({ timeout: 15000 })
    await expect(modal.getByTestId('nfse-emitir-submit')).toBeDisabled()
    await expect(modal.getByTestId('nfse-retencoes-previa-nenhuma')).toHaveCount(0)
    expect(envios.length, 'nada foi enviado para a emissão').toBe(0)
  })
})
