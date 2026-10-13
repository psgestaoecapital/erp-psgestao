// RD-83 · CAMINHO PRINCIPAL da tela Contratos → Solicitações & Fee (P&M), entregue com o chamado #59.
// Abrir a tela, solicitar um contrato típico (dados novos: título + valor) e conferir no banco.
// Não depende de migration nova (roda no preview da PR) e entra na varredura semanal em produção
// (jornadas-revenda.yml: testDir = e2e/jornadas). Demonstração Agência (P&M), nunca empresa real
// (sem usuário 'financeiro' na demo → nenhum e-mail sai). Contrato de teste excluído (soft) no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada } from '../../support/api'

const DEMO_AGENCIA = 'b0700000-0000-4000-a000-000000000002'
const TITULO = `Caminho contratos ${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

test.describe('Caminho principal — Contratos (P&M): solicitar contrato grava no banco', () => {
  const criados: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-pm-contratos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AGENCIA}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    for (const id of criados) await dbPatch('erp_contratos', `id=eq.${id}`, { status: 'excluido', excluido_em: new Date().toISOString(), motivo_exclusao: 'jornada caminho principal (teste)' })
  })

  test('abrir Solicitações & Fee, solicitar contrato com título e valor → fica "solicitado" no banco', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AGENCIA)
    await page.goto('/dashboard/contratos?tab=fee')
    await aguardarConteudo(page)

    await page.getByRole('button', { name: '+ Solicitar elaboração' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Solicitar elaboração de contrato' })
    await expect(dialogo).toBeVisible({ timeout: 20000 })
    await dialogo.getByRole('button', { name: 'Com dados novos' }).click()
    await dialogo.locator('xpath=.//label[starts-with(normalize-space(.), "Título do contrato")]/following-sibling::input[1]').fill(TITULO)
    await dialogo.locator('xpath=.//label[starts-with(normalize-space(.), "Valor")]/following-sibling::input[1]').fill('1250,00')
    await dialogo.getByTestId('solicitar-contrato').click()
    await expect(page.getByTestId('solicitacao-criada')).toBeVisible({ timeout: 20000 })

    const linhas = await dbSelect<{ id: string; status: string; valor_mensal: number; origem: string | null; solicitante_id: string | null }>(
      'erp_contratos', `company_id=eq.${DEMO_AGENCIA}&nome=eq.${encodeURIComponent(TITULO)}&select=id,status,valor_mensal,origem,solicitante_id`)
    expect(linhas, 'um contrato criado pela tela').toHaveLength(1)
    criados.push(linhas[0].id)
    expect(linhas[0]).toMatchObject({ status: 'solicitado', origem: 'manual' })
    expect(Number(linhas[0].valor_mensal)).toBe(1250)
    expect(linhas[0].solicitante_id, 'quem pediu fica registrado').toBeTruthy()
  })
})
