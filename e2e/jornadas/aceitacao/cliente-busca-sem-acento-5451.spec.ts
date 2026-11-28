// #5451 (cadastros/clientes) · "Na hora de pesquisar o cliente (ex.: ROMÁRIO), se não botar o acento
// ou não escrever 100% o cadastro, ele não puxa." Causa: a busca usava ILIKE, que ignora maiúsculas
// mas NÃO ignora acento. Agora o front filtra a coluna gerada `busca_norm` (nome+razão, minúsculo e
// sem acento) com o termo também normalizado — então "romario" / "ROMARIO" acham "Romário".
// @pos-migration: só passa com a migration 20261124180130 aplicada (coluna busca_norm).
// Demonstração Comércio (GE), nunca empresa real. Cadastros de teste desativados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const criados: string[] = []

async function cliente(nome: string) {
  const c = await dbInsert<{ id: string }>('erp_clientes', {
    company_id: DEMO_COMERCIO, nome_fantasia: nome, razao_social: nome, tipo_pessoa: 'PF', ativo: true,
  })
  criados.push(c.id)
  return c.id
}

test.describe('Cadastro de clientes — busca acha com ou sem acento (#5451)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-5451-busca-sem-acento', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    for (const id of criados) await dbPatch('erp_clientes', `id=eq.${id}`, { ativo: false })
  })

  test('pesquisar sem o acento acha o cadastro com acento @pos-migration', async ({ page }) => {
    // nome com acento + marca única por execução
    const marca = `Rom${'á'}rio Concei${'ç'}${'ã'}o ${RUN}` // "Romário Conceição <RUN>"
    const semAcento = `Romario Conceicao ${RUN}`
    await cliente(marca)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/cadastros/clientes')
    await aguardarConteudo(page)

    const campo = page.getByPlaceholder('Buscar por nome ou CNPJ/CPF…')

    // 1) digitando SEM acento -> acha o cadastro com acento (o bug do chamado)
    await campo.fill(semAcento)
    await expect(page.getByText(marca, { exact: true })).toBeVisible({ timeout: 20000 })

    // 2) digitando só parte do nome, sem acento -> ainda acha (não precisa escrever 100%)
    await campo.fill(`conceicao ${RUN}`)
    await expect(page.getByText(marca, { exact: true })).toBeVisible({ timeout: 20000 })

    // 3) digitando COM acento -> continua achando (sem regressão)
    await campo.fill(marca)
    await expect(page.getByText(marca, { exact: true })).toBeVisible({ timeout: 20000 })
  })
})
