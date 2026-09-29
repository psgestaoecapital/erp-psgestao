// Relatório Plano Gerencial × Contábil (CEO 29/09 · FC): o cartão "Contas gerenciais" contava LINHAS do relatório (uma
// por vínculo) — a FC mostrava 121 em vez de 34. Agora conta contas. Prova na Demonstração Comércio GE: duas contábeis
// de teste ligadas à MESMA gerencial (mais linhas que contas); o cartão tem de bater com as contas da árvore.
// Contas de teste criadas e removidas no teste.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const criadas: string[] = []

test.describe('Relatório Plano Gerencial × Contábil — cartão "Contas gerenciais" conta contas, não linhas', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [g] = await dbSelect<{ id: string }>('erp_plano_contas',
      `company_id=eq.${DEMO_GE}&ativo=eq.true&is_totalizador=eq.false&select=id&order=codigo&limit=1`)
    expect(g, 'a demo tem plano gerencial').toBeTruthy()
    for (const n of [1, 2]) {
      const c = await dbInsert<{ id: string }>('erp_conta_contabil', { company_id: DEMO_GE, codigo: `9.KPI${RUN}.${n}`, descricao: `E2E KPI ${n}`, analitica: true, nivel: 3 })
      criadas.push(c.id)
      await dbInsert('erp_conta_contabil_vinculo', { company_id: DEMO_GE, plano_conta_id: g.id, conta_contabil_id: c.id, observacao: 'e2e kpi' })
    }
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-plano-contas-relatorio-kpi', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const id of criadas) {
      await dbDelete('erp_conta_contabil_vinculo', `conta_contabil_id=eq.${id}`).catch(() => {})
      await dbDelete('erp_conta_contabil', `id=eq.${id}`).catch(() => {})
    }
  })

  test('"Contas gerenciais" = nº de contas na árvore (uma gerencial com 2 contábeis conta 1 vez)', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/cadastros/plano-contas/relatorio')
    await aguardarConteudo(page)
    await expect(page.getByTestId('relatorio-arvore')).toBeVisible({ timeout: 30000 })

    const contasNaArvore = await page.locator('[data-testid^="ger-"]').count()
    expect(contasNaArvore, 'a árvore tem contas').toBeGreaterThan(0)
    const vinculadasNaArvore = await page.locator('[data-testid^="ger-"] [data-testid^="cont-"]').count()
    expect(vinculadasNaArvore, 'há mais linhas (vínculos) que contas com vínculo — o caso do bug').toBeGreaterThanOrEqual(2)

    const cartao = page.getByTestId('kpi-gerenciais')
    await expect(cartao).toContainText('Contas gerenciais')
    await expect(cartao, 'o cartão mostra o nº de contas, não de linhas').toContainText(String(contasNaArvore))
    const texto = (await cartao.innerText()).replace(/\D+/g, ' ').trim().split(' ').filter(Boolean)
    expect(texto.map(Number), 'o número do cartão é exatamente o de contas').toContain(contasNaArvore)
  })
})
