// #339 (R.R · Rodrigo, REABERTO 01/10) · "precisamos preencher e reter quando necessário, como regra geral": a retenção
// muda de tomador para tomador com o MESMO serviço. Agora a seção "Retenções desta nota" começa igual ao cadastro e é
// editável na nota (ISS retido + INSS/IR/PIS/COFINS/CSLL com alíquota), com "Sugerir" pela regra do CEO:
//  • tomador pessoa física não retém nada;
//  • prestador do Simples, em regra, sem IR/PIS/COFINS/CSLL (INSS e ISS seguem o cadastro).
// O que a tela manda é o que a rota aplica (mesma conta) — aqui a emissão é interceptada e o corpo é conferido.
// Demonstração Comércio (GE); serviço de teste criado e removido no fim. Nenhuma nota real.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'
import type { Page } from '@playwright/test'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36)
const SEM = `E2E 339b sem retencao ${RUN}`
const COM = `E2E 339b IR PIS INSS ${RUN}`
const criados: string[] = []

async function abrirModal(page: Page, opcaoSimples: number, descricao: string, doc: string) {
  await page.route(/\/rest\/v1\/erp_fiscal_provider_config\?.*ativo=eq\.true/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/vnd.pgrst.object+json', body: JSON.stringify({ provider: 'focusnfe', opcao_simples_nacional: opcaoSimples }) }))
  await page.route(/\/rest\/v1\/rpc\/fn_nfse_validar_emissao/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pode_emitir: true, bloqueios: [] }) }))
  const envios: Record<string, unknown>[] = []
  await page.route('**/api/fiscal/nfse/emitir', async (route) => {
    envios.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, status: 'autorizada', numero: '996', nfseId: '00000000-0000-4000-a000-000000003390', providerReference: `e2e-339b-${RUN}`, retencoesFederais: null,
    }) })
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
  await modal.getByTestId('nfse-tomador-tipo').selectOption(doc.length === 11 ? 'CPF' : 'CNPJ')
  await modal.getByTestId('nfse-tomador-doc').fill(doc)
  const secao = modal.getByTestId('nfse-retencoes-nota')
  await expect(secao).toBeVisible({ timeout: 15000 })
  return { modal, secao, envios }
}

test.describe('#339 · retenções editáveis na nota, com "Sugerir" pelo regime de quem emite e pelo tomador', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    for (const s of [
      { codigo: `U${RUN}`, descricao_resumida: SEM },
      { codigo: `V${RUN}`, descricao_resumida: COM, retem_ir: true, aliquota_ir: 1.5, retem_pis: true, aliquota_pis: 0.65, retem_inss: true, aliquota_inss: 11, cst_pis_cofins: '01' },
    ]) {
      const r = await dbInsert<{ id: string }>('erp_servicos', {
        company_id: DEMO_GE, ativo: true, valor_unitario: 1000, codigo_servico_municipio: '070201', codigo_lc116: '07.02', ...s,
      })
      criados.push(r.id)
    }
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-339-nfse-retencoes-editaveis', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { for (const id of criados) await dbDelete('erp_servicos', `id=eq.${id}`).catch(() => {}) })

  test('caminho principal: serviço sem retenção, a pessoa marca ISS retido e INSS 11% nesta nota → vai na emissão', async ({ page }) => {
    const { modal, secao, envios } = await abrirModal(page, 1, SEM, '11222333000181')
    await expect(secao.getByTestId('nfse-retencoes-ajustada')).toHaveCount(0)
    await secao.getByTestId('nfse-ret-iss').check()
    await secao.getByTestId('nfse-ret-inss').check()
    await secao.getByTestId('nfse-ret-aliq-inss').fill('11')
    await expect(secao.getByTestId('nfse-retencoes-ajustada'), 'a tela diz que a nota foi ajustada').toBeVisible()
    await expect(secao.getByTestId('nfse-ret-linha-inss')).toContainText('R$')
    await modal.getByTestId('nfse-emitir-submit').click()
    await expect.poll(() => envios.length, { timeout: 15000 }).toBe(1)
    const r = envios[0].retencoesNota as Record<string, unknown>
    expect(r?.iss_retido, 'ISS retido desta nota').toBe(true)
    expect(r?.retem_inss).toBe(true)
    expect(r?.aliquota_inss).toBe(11)
    expect(envios[0].tipoRetencaoIss, 'ISS retido pelo tomador (2)').toBe(2)
  })

  test('Sugerir com tomador pessoa física: nenhuma retenção', async ({ page }) => {
    const { secao } = await abrirModal(page, 1, COM, '52998224725')
    await expect(secao.getByTestId('nfse-ret-ir'), 'o cadastro retém IR').toBeChecked()
    await secao.getByTestId('nfse-retencoes-sugerir').click()
    await expect(secao.getByTestId('nfse-retencoes-sugestao')).toContainText('pessoa física')
    for (const k of ['iss', 'inss', 'ir', 'pis', 'cofins', 'csll']) await expect(secao.getByTestId(`nfse-ret-${k}`)).not.toBeChecked()
    await expect(secao.getByTestId('nfse-retencoes-total')).toContainText('R$ 0,00')
  })

  test('Sugerir com prestador do Simples e tomador CNPJ: sem IR/PIS/COFINS/CSLL, INSS do cadastro mantido', async ({ page }) => {
    const { secao, modal, envios } = await abrirModal(page, 3, COM, '11222333000181')
    await secao.getByTestId('nfse-retencoes-sugerir').click()
    await expect(secao.getByTestId('nfse-retencoes-sugestao')).toContainText('Simples Nacional')
    await expect(secao.getByTestId('nfse-ret-ir')).not.toBeChecked()
    await expect(secao.getByTestId('nfse-ret-pis')).not.toBeChecked()
    await expect(secao.getByTestId('nfse-ret-inss'), 'INSS segue o cadastro').toBeChecked()
    await secao.getByTestId('nfse-retencoes-cadastro').click()
    await expect(secao.getByTestId('nfse-ret-ir'), '"Voltar ao cadastro" desfaz o ajuste').toBeChecked()
    await secao.getByTestId('nfse-retencoes-sugerir').click()
    await modal.getByTestId('nfse-emitir-submit').click()
    await expect.poll(() => envios.length, { timeout: 15000 }).toBe(1)
    const r = envios[0].retencoesNota as Record<string, unknown>
    expect(r?.retem_ir).toBe(false)
    expect(r?.retem_pis).toBe(false)
    expect(r?.retem_inss).toBe(true)
  })
})
