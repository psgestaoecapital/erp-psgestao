// #4050 (Gean) · Fiscal → Devolução de compra: depois de emitir, a própria tela oferece "Baixar DANFE (PDF)" e
// "Baixar XML" (antes era preciso procurar a nota em NF-e emitidas). Nenhuma nota é emitida: a resposta da emissão,
// o registro da nota e o arquivo do provedor são simulados; o arquivo ainda não guardado no storage cai no link do
// provedor (caso real: a cópia no storage chega minutos depois da autorização). Sem migration no caminho: o "?" é só
// texto do banco. Demonstração Comércio (GE).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const NFE_ID = '4050e2e0-0000-4000-a000-000000004050'
const DANFE_URL = 'https://arquivos-provedor.e2e.invalid/danfe-650.pdf'

test.describe('#4050 · devolução de compra: baixar DANFE/XML na própria tela', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-4050-nfe-devolucao-baixar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('emitiu → "Baixar DANFE (PDF)" salva o arquivo com o número da nota', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [rec] = await dbSelect<{ id: string }>('erp_nfe_recebidas',
      `company_id=eq.${DEMO_COMERCIO}&chave_acesso=not.is.null&fornecedor_id=not.is.null&select=id&limit=1`)
    expect(rec, 'a demonstração tem NF-e de compra com fornecedor').toBeTruthy()
    const [prod] = await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&select=id&limit=1`)
    expect(prod, 'a demonstração tem produto').toBeTruthy()

    // um item com produto vinculado, para o botão de emitir ficar disponível
    await page.route(/\/rest\/v1\/erp_nfe_recebidas_itens\?/, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ produto_id: prod.id, codigo_produto: 'E2E', descricao: 'Item devolvido E2E', quantidade: 1, valor_unitario: 10 }]),
    }))
    const envios: unknown[] = []
    await page.route('**/api/fiscal/nfe/devolucao', async (route) => {
      envios.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, nfeId: NFE_ID, status: 'autorizada', processando: false, numero: '650', chave: '4'.repeat(44) }) })
    })
    await page.route(new RegExp(`/rest/v1/erp_nfe_emitidas\\?.*id=eq\\.${NFE_ID}`), (route) => route.fulfill({
      status: 200, contentType: 'application/vnd.pgrst.object+json',
      body: JSON.stringify({ numero: '650', data_emissao: '2026-10-22T16:37:00Z', destinatario_razao_social: 'Fornecedor E2E Ltda', danfe_url: DANFE_URL, xml_url: null }),
    }))
    // cópia no storage ainda não guardada → usa o link do provedor
    await page.route(/\/rest\/v1\/rpc\/fn_fiscal_get_storage_url/, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, erro: 'Arquivo ainda não armazenado' }) }))
    await page.route(DANFE_URL, (route) => route.fulfill({
      status: 200, contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': '*' }, body: '%PDF-1.4 e2e' }))
    page.on('dialog', (d) => void d.accept())

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto(`/dashboard/fiscal/nfe/devolucao?recebida_id=${rec.id}`)
    await aguardarConteudo(page)

    const emitir = page.getByTestId('nfe-devol-emitir')
    await expect(emitir).toBeEnabled({ timeout: 20000 })
    await expect(page.getByTestId('nfe-devol-baixar-pdf'), 'sem emissão, não há o que baixar').toHaveCount(0)
    await emitir.click()

    const pdf = page.getByTestId('nfe-devol-baixar-pdf')
    await expect(pdf).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('nfe-devol-baixar-xml')).toBeVisible()
    expect(envios, 'a emissão foi pedida uma vez').toHaveLength(1)

    const [download] = await Promise.all([page.waitForEvent('download'), pdf.click()])
    expect(download.suggestedFilename()).toMatch(/NF650.*\.pdf$/)
  })
})
