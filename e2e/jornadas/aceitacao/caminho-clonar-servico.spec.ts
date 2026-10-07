// Rodrigo · botão "Clonar" em Serviços. Cria um serviço, clona pela listagem e confere que o clone:
//  - abre pré-preenchido com a descrição + "(cópia)";
//  - recebe um NOVO código (SRV#####, diferente do original — não copia o código);
//  - grava como um registro novo (insert), sem tocar o original.
// Demonstração Comércio (GE). Os dois serviços de teste são apagados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const DESC = `Serviço clonar ${RUN}`
const DESC_COPIA = `${DESC} (cópia)`

test.describe('Caminho — Clonar Serviço', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-clonar-servico', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const d of [DESC, DESC_COPIA]) {
      await dbDelete('erp_servicos', `company_id=eq.${DEMO_COMERCIO}&descricao_resumida=eq.${encodeURIComponent(d)}`).catch(() => {})
    }
  })

  test('Clonar serviço → pré-preenche + novo código + grava novo registro', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/cadastros/servicos')
    await aguardarConteudo(page)

    // 1) cria o serviço original (código SRV##### é gerado automaticamente)
    await page.getByTestId('servico-novo').click()
    await page.getByPlaceholder('ex: Hora técnica de mecânica').fill(DESC)
    await page.getByTestId('servico-salvar').click()
    await expect.poll(async () =>
      (await dbSelect('erp_servicos', `company_id=eq.${DEMO_COMERCIO}&descricao_resumida=eq.${encodeURIComponent(DESC)}&select=id`)).length,
      { timeout: 20000 }).toBe(1)
    const [orig] = await dbSelect<{ codigo: string }>('erp_servicos', `company_id=eq.${DEMO_COMERCIO}&descricao_resumida=eq.${encodeURIComponent(DESC)}&select=codigo`)
    expect(orig?.codigo).toMatch(/^SRV\d+/)

    // 2) filtra pela descrição e clona a linha
    await page.getByTestId('servico-busca').fill(DESC)
    await expect.poll(async () => page.getByTestId('servico-clonar').count(), { timeout: 10000 }).toBeGreaterThan(0)
    await page.getByTestId('servico-clonar').first().click()

    // 3) o form abre pré-preenchido: descrição com "(cópia)" e um novo SRV (≠ original)
    await expect(page.getByTestId('servico-clone-aviso')).toBeVisible()
    await expect(page.getByPlaceholder('ex: Hora técnica de mecânica')).toHaveValue(DESC_COPIA)
    await expect(page.getByPlaceholder('ex: SRV00001')).toHaveValue(/^SRV\d+/)
    const novoCod = await page.getByPlaceholder('ex: SRV00001').inputValue()
    expect(novoCod).not.toBe(orig?.codigo)

    // 4) salva o clone → novo registro no banco (o original continua lá, intacto)
    await page.getByTestId('servico-salvar').click()
    await expect.poll(async () =>
      (await dbSelect('erp_servicos', `company_id=eq.${DEMO_COMERCIO}&descricao_resumida=eq.${encodeURIComponent(DESC_COPIA)}&select=id`)).length,
      { timeout: 20000 }).toBe(1)
    const [clone] = await dbSelect<{ codigo: string }>('erp_servicos', `company_id=eq.${DEMO_COMERCIO}&descricao_resumida=eq.${encodeURIComponent(DESC_COPIA)}&select=codigo`)
    expect(clone?.codigo).toMatch(/^SRV\d+/)
    expect(clone?.codigo).not.toBe(orig?.codigo)
    // o original permanece (clone não é um update disfarçado)
    expect((await dbSelect('erp_servicos', `company_id=eq.${DEMO_COMERCIO}&descricao_resumida=eq.${encodeURIComponent(DESC)}&select=id`)).length).toBe(1)
  })
})
