// Caixa jordana-code 25fac6b6 (Pdois/Gean · Jordana): cliente salvo com cidade + UF e SEM o código IBGE do município —
// a NFS-e trava. Prova no dado: "Laboratório Costa Rosa" (Pdois) salvo pela tela Cadastros › Clientes com CEP 79950000,
// Naviraí/MS e codigo_ibge_municipio NULL (a tela nunca enviava o IBGE). Dois lados:
//  (1) gatilho trg_clientes_ibge_auto: IBGE vazio + cidade/UF que casam na tabela oficial → preenche (tela, importação,
//      sincronização); IBGE já informado nunca é trocado; cidade que não existe → fica vazio (não inventa);
//  (2) a tela: CEP digitado e Salvar (sem clicar em Buscar) grava cidade, UF e o IBGE; IBGE digitado inválido é recusado.
// Demonstração Comércio (GE), nunca empresa real. Cadastros de teste desativados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const NAVIRAI_MS = '5005707'
const CHAPECO_SC = '4204202'

type Cli = { id: string; cidade: string | null; uf: string | null; cep: string | null; codigo_ibge_municipio: string | null }
const criados: string[] = []

async function cliente(campos: Record<string, unknown>) {
  const c = await dbInsert<{ id: string }>('erp_clientes', {
    company_id: DEMO_COMERCIO, tipo_pessoa: 'PJ', ativo: true, nome_fantasia: `Cliente IBGE ${RUN}`, ...campos,
  })
  criados.push(c.id)
  return c.id
}
const ler = async (id: string) =>
  (await dbSelect<Cli>('erp_clientes', `id=eq.${id}&select=id,cidade,uf,cep,codigo_ibge_municipio`))[0]

test.describe('Cliente: CEP/cidade/UF gravam e o IBGE do município preenche sozinho (caixa 25fac6b6)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-cliente-cep-ibge-auto', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    for (const id of criados) await dbPatch('erp_clientes', `id=eq.${id}`, { ativo: false })
  })

  test('gatilho: IBGE vazio é preenchido pela cidade + UF; informado nunca é trocado; cidade inexistente fica vazio', { tag: '@pos-migration' }, async () => {
    // caso do chamado: Naviraí/MS com acento, sem IBGE
    expect((await ler(await cliente({ cidade: 'Naviraí', uf: 'MS', cep: '79950000' }))).codigo_ibge_municipio).toBe(NAVIRAI_MS)
    // importação: sufixo " (UF)", caixa alta e sem acento
    expect((await ler(await cliente({ cidade: 'CHAPECO (SC)', uf: 'sc' }))).codigo_ibge_municipio).toBe(CHAPECO_SC)
    // "Cidade/UF" no mesmo campo
    expect((await ler(await cliente({ cidade: 'Navirai/MS', uf: 'MS' }))).codigo_ibge_municipio).toBe(NAVIRAI_MS)
    // IBGE já informado: o gatilho não mexe
    expect((await ler(await cliente({ cidade: 'Naviraí', uf: 'MS', codigo_ibge_municipio: CHAPECO_SC }))).codigo_ibge_municipio).toBe(CHAPECO_SC)
    // não acha → não inventa
    expect((await ler(await cliente({ cidade: 'Cidade Que Não Existe', uf: 'MS' }))).codigo_ibge_municipio ?? '').toBe('')

    // UPDATE: cadastro antigo sem cidade recebe a cidade depois → IBGE preenche no mesmo salvar
    const antigo = await cliente({})
    expect((await ler(antigo)).codigo_ibge_municipio ?? '').toBe('')
    await dbPatch('erp_clientes', `id=eq.${antigo}`, { cidade: 'Naviraí', uf: 'MS' })
    expect((await ler(antigo)).codigo_ibge_municipio).toBe(NAVIRAI_MS)
  })

  async function abrirNovoCliente(page: import('@playwright/test').Page) {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/cadastros/clientes')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: /Novo cliente/ }).first().click()
  }
  const campo = (page: import('@playwright/test').Page, rotulo: string) =>
    page.locator('div', { has: page.locator('label', { hasText: rotulo }) }).last().locator('input').first()

  test('tela: CEP digitado e Salvar (sem Buscar) grava cidade, UF e o IBGE do município', async ({ page }) => {
    const nome = `Cliente CEP ${RUN}`
    await abrirNovoCliente(page)
    await campo(page, 'Nome / Apelido').fill(nome)
    await page.getByPlaceholder('00000-000').fill('79950-000')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()

    await expect.poll(async () => {
      const [c] = await dbSelect<Cli>('erp_clientes', `company_id=eq.${DEMO_COMERCIO}&nome_fantasia=eq.${encodeURIComponent(nome)}&select=id,cidade,uf,cep,codigo_ibge_municipio`)
      if (c && !criados.includes(c.id)) criados.push(c.id)
      return c ? `${c.cep}|${c.uf}|${c.codigo_ibge_municipio}` : null
    }, { timeout: 20000, message: 'cliente gravado com CEP, UF e IBGE' }).toBe(`79950000|MS|${NAVIRAI_MS}`)
  })

  test('tela: IBGE digitado com menos de 7 números é recusado com mensagem que ensina', async ({ page }) => {
    await abrirNovoCliente(page)
    await campo(page, 'Nome / Apelido').fill(`Cliente IBGE ruim ${RUN}`)
    await page.getByPlaceholder('7 números').fill('50057')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByText(/Código IBGE do município tem 7 números/)).toBeVisible({ timeout: 10000 })
  })
})
