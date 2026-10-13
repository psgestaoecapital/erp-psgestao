// Rodrigo · botão "Clonar" em Produtos. Cria um produto, clona pela listagem e confere que o clone:
//  - abre pré-preenchido com o nome + "(cópia)";
//  - abre com o código VAZIO (produto não tem gerador automático — o usuário informa um novo);
//  - grava como um registro novo (insert/POST), sem tocar o original.
// Demonstração Comércio (GE). Os dois produtos de teste são apagados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const COD = `CLON-${RUN}`
const COD_CLONE = `CLON2-${RUN}`
const NOME = `Produto clonar ${RUN}`
const NOME_COPIA = `${NOME} (cópia)`

test.describe('Caminho — Clonar Produto', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-clonar-produto', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const c of [COD, COD_CLONE]) {
      await dbDelete('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&codigo=eq.${encodeURIComponent(c)}`).catch(() => {})
    }
  })

  test('Clonar produto → pré-preenche + código vazio + grava novo registro', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/cadastros/produtos')
    await aguardarConteudo(page)

    // 1) cria o produto original (código informado manualmente)
    await page.getByTestId('produto-novo').click()
    await page.getByPlaceholder('ex: PROD-001').fill(COD)
    await page.getByPlaceholder('Tinta acrilica branca 18L').fill(NOME)
    await page.getByTestId('produto-salvar').click()
    await expect.poll(async () =>
      (await dbSelect('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&codigo=eq.${encodeURIComponent(COD)}&select=id`)).length,
      { timeout: 20000 }).toBe(1)

    // 2) filtra pelo código e clona a linha
    await page.getByPlaceholder('Buscar por nome, codigo ou NCM...').fill(COD)
    await expect.poll(async () => page.getByTestId('produto-clonar').count(), { timeout: 10000 }).toBeGreaterThan(0)
    await page.getByTestId('produto-clonar').first().click()

    // 3) form pré-preenchido: nome com "(cópia)" e código VAZIO (precisa informar um novo)
    await expect(page.getByTestId('produto-clone-aviso')).toBeVisible()
    await expect(page.getByPlaceholder('Tinta acrilica branca 18L')).toHaveValue(NOME_COPIA)
    await expect(page.getByPlaceholder('ex: PROD-001')).toHaveValue('')

    // 4) informa o novo código e salva → novo registro (original intacto)
    await page.getByPlaceholder('ex: PROD-001').fill(COD_CLONE)
    await page.getByTestId('produto-salvar').click()
    await expect.poll(async () =>
      (await dbSelect('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&codigo=eq.${encodeURIComponent(COD_CLONE)}&select=id`)).length,
      { timeout: 20000 }).toBe(1)
    const [clone] = await dbSelect<{ nome: string }>('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&codigo=eq.${encodeURIComponent(COD_CLONE)}&select=nome`)
    expect(clone?.nome).toBe(NOME_COPIA)
    // o original permanece (clone não é update disfarçado)
    expect((await dbSelect('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&codigo=eq.${encodeURIComponent(COD)}&select=id`)).length).toBe(1)
  })
})
