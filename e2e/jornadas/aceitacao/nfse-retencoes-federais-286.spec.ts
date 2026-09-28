// #286 (FC Pisos · Jordana) · a NFS-e não levava as retenções federais do cadastro do serviço (NF 421 saiu sem os
// R$ 10.798,23 de INSS). Agora: a tela mostra as retenções ANTES de emitir (do cadastro do serviço), a rota manda os
// mesmos valores para a nota e o "Gerar financeiro" usa exatamente os da nota (campos travados — nunca divergem).
// As regras de rejeição do leiaute (E0699/E0700/E0720/E0694/E0696/E0901) são conferidas no build
// (scripts/check-retencoes-nfse.ts). A demo não emite nota real: a emissão é interceptada.
// Demonstração Comércio (GE); serviços de teste criados e removidos no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36)
const criados: string[] = []

async function abrirModalComServico(page: import('@playwright/test').Page, descricao: string, resposta: Record<string, unknown>) {
  await page.route(/\/rest\/v1\/erp_fiscal_provider_config\?.*ativo=eq\.true/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/vnd.pgrst.object+json', body: JSON.stringify({ provider: 'focusnfe', opcao_simples_nacional: 1 }) }))
  await page.route(/\/rest\/v1\/rpc\/fn_nfse_validar_emissao/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pode_emitir: true, bloqueios: [] }) }))
  const envios: Record<string, unknown>[] = []
  await page.route('**/api/fiscal/nfse/emitir', async (route) => {
    envios.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta) })
  })
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
  await page.goto('/dashboard/fiscal/nfse')
  await aguardarConteudo(page)
  await page.getByTestId('nfse-nova').click()
  const modal = page.getByTestId('nfse-emitir-modal')
  const sel = modal.getByTestId('nfse-servico-select')
  await expect(sel).toBeVisible({ timeout: 20000 })
  const valor = await sel.locator('option', { hasText: descricao }).getAttribute('value')
  expect(valor, 'o serviço de teste aparece na lista').toBeTruthy()
  await sel.selectOption(valor!)
  return { modal, envios }
}

test.describe('#286 · NFS-e com as retenções federais do cadastro do serviço', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    for (const s of [
      { codigo: `R${RUN}`, descricao_resumida: `E2E 286 com INSS ${RUN}`, retem_inss: true, aliquota_inss: 11 },
      { codigo: `S${RUN}`, descricao_resumida: `E2E 286 sem retencao ${RUN}` },
    ]) {
      const r = await dbInsert<{ id: string }>('erp_servicos', {
        company_id: DEMO_GE, ativo: true, valor_unitario: 1000, codigo_servico_municipio: '070501', codigo_lc116: '07.05', ...s,
      })
      criados.push(r.id)
    }
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-286-nfse-retencoes', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { for (const id of criados) await dbDelete('erp_servicos', `id=eq.${id}`).catch(() => {}) })

  test('serviço com INSS: tela mostra a retenção antes de emitir e o financeiro usa a mesma, travada', async ({ page }) => {
    const { modal, envios } = await abrirModalComServico(page, `E2E 286 com INSS ${RUN}`, {
      ok: true, status: 'autorizada', numero: '999', nfseId: '00000000-0000-4000-a000-000000000286', providerReference: `e2e-286-${RUN}`,
      retencoesFederais: { inss: 110, irrf: 0, pis: 0, cofins: 0, csll: 0, total: 110 }, issRetido: 30,
    })
    const previa = modal.getByTestId('nfse-retencoes-previa')
    await expect(previa, 'retenções aparecem ANTES de emitir').toBeVisible({ timeout: 15000 })
    await expect(previa.getByTestId('nfse-retencoes-previa-valores')).toContainText('INSS R$ 110,00')
    await expect(previa.getByTestId('nfse-retencoes-previa-valores')).toContainText('total retido R$ 110,00')
    await modal.getByTestId('nfse-emitir-submit').click()
    await expect.poll(() => envios.length, { timeout: 15000 }).toBe(1)
    const inss = modal.getByTestId('nfse-fin-ret-inss')
    await expect(inss, 'o financeiro nasce com o INSS que foi na nota').toHaveValue('110,00', { timeout: 15000 })
    await expect(inss, 'e não se edita (nota e título nunca divergem)').toHaveAttribute('readonly', '')
    await expect(modal.getByTestId('nfse-fin-ret-iss'), 'o ISS retido da nota também vem preenchido').toHaveValue('30,00')
    await expect(modal.getByTestId('nfse-sugerir-retencoes'), 'a sugestão manual de retenções saiu').toHaveCount(0)
  })

  test('caminho principal: serviço sem retenção emite normalmente, sem bloco de retenções', async ({ page }) => {
    const { modal, envios } = await abrirModalComServico(page, `E2E 286 sem retencao ${RUN}`, {
      ok: true, status: 'autorizada', numero: '998', nfseId: '00000000-0000-4000-a000-000000000287', providerReference: `e2e-286s-${RUN}`,
      retencoesFederais: null,
    })
    await expect(modal.getByTestId('nfse-retencoes-previa')).toHaveCount(0)
    await expect(modal.getByTestId('nfse-emitir-submit')).toBeEnabled()
    await modal.getByTestId('nfse-emitir-submit').click()
    await expect.poll(() => envios.length, { timeout: 15000 }).toBe(1)
    await expect(modal.getByTestId('nfse-fin-ret-inss')).toHaveValue('', { timeout: 15000 })
  })
})
