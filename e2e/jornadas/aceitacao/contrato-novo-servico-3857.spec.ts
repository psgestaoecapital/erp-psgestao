// #3857 (Pdois) · Novo Contrato Recorrente: empresa com catálogo próprio de serviços (agency_servico) vê no modal
// SÓ os serviços dela, no lugar da lista genérica de tipos (BPO, academia, clínica…). Escolher o serviço preenche o
// nome do contrato. Só leitura: abre o modal e confere a lista com o banco — não cria contrato.
// Demonstração Agência (P&M), nunca empresa real.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_AGENCIA = 'b0700000-0000-4000-a000-000000000002'

test.describe('#3857 — Novo contrato lista os serviços da própria empresa', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('contrato-novo-servico-3857', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('modal "+ Novo Contrato" mostra o catálogo da empresa e o serviço vira o nome do contrato', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AGENCIA}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)
    const servicos = await dbSelect<{ nome: string }>('agency_servico', `company_id=eq.${DEMO_AGENCIA}&ativo=eq.true&select=nome`)
    const nomes = servicos.map((s) => (s.nome ?? '').trim()).filter(Boolean)
    test.skip(nomes.length === 0, 'DEMO Agência sem catálogo de serviços ativo')

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AGENCIA)
    await page.goto('/dashboard/contratos')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: '+ Novo Contrato', exact: true }).click()

    const sel = page.getByTestId('novo-contrato-servico')
    await expect(sel, 'com catálogo, o campo é "Serviço"').toBeVisible({ timeout: 20000 })
    const opcoes = (await sel.locator('option').allTextContents()).map((t) => t.trim()).filter((t) => !t.startsWith('—'))
    expect(opcoes.sort()).toEqual([...nomes].sort())
    expect(opcoes, 'a lista genérica de tipos não aparece').not.toContain('💪 Academia/Fitness')

    await sel.selectOption({ label: nomes[0] })
    await expect(page.getByPlaceholder('Ex: BPO Financeiro Mensal Premium')).toHaveValue(nomes[0])
  })
})
