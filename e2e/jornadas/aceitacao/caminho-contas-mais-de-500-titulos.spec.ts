// RD-83 · /dashboard/contas com mais de 500 títulos (incidente 07/10, Estância Umuarama): os 500 mais antigos eram
// todos pagos e a tela mostrava R$ 0 / "nenhum lançamento". Aqui: 520 recebidos antigos + 1 pendente novo → a tela
// precisa achar o pendente por padrão (filtros na consulta), contar nos KPIs e dizer "Mostrando X de Y".
// Não depende de migration (roda no preview). Demonstração Comércio, nunca empresa real; títulos de teste apagados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbInsertMany, dbDelete, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const DESC_PEND = `Contas500 pendente ${RUN}`
const DESC_ANT = `Contas500 antigo ${RUN}`

test.describe('Caminho — Contas a Pagar e Receber com mais de 500 títulos', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-contas-mais-de-500', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    await dbDelete('erp_receber', `company_id=eq.${DEMO_COMERCIO}&descricao=like.${encodeURIComponent(`Contas500 % ${RUN}`)}`).catch(() => {})
  })

  test('pendente só nos mais novos aparece, entra nos KPIs e a lista diz "Mostrando X de Y"', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const antigos = Array.from({ length: 520 }, (_, i) => ({
      company_id: DEMO_COMERCIO, descricao: `${DESC_ANT} ${i}`, cliente_nome: 'Cliente Antigo', valor: 10,
      data_emissao: '2020-01-01', data_vencimento: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`, status: 'pago',
    }))
    for (let i = 0; i < antigos.length; i += 130) await dbInsertMany('erp_receber', antigos.slice(i, i + 130))
    await dbInsert('erp_receber', {
      company_id: DEMO_COMERCIO, descricao: DESC_PEND, cliente_nome: 'Cliente Novo', valor: 777,
      data_emissao: '2099-01-01', data_vencimento: '2099-01-02', status: 'aberto',
    })

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/contas')
    await aguardarConteudo(page)

    // padrão = pendentes: o título novo aparece mesmo havendo 520 pagos mais antigos
    await page.getByPlaceholder(/Buscar por descrição/).fill(RUN)
    await expect(page.locator('tr', { hasText: DESC_PEND })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('contas-vazio')).toHaveCount(0)
    await expect(page.getByTestId('contas-mostrando')).toContainText('Mostrando 1 de 1')

    // KPI "A Receber" inclui os R$ 777 (não é R$ 0,00)
    await expect(page.getByText('A Receber').locator('xpath=following-sibling::div[1]')).not.toHaveText(/R\$\s*0,00$/, { timeout: 20000 })

    // Pagos: pagina (100 por vez) e informa o total
    await page.getByRole('button', { name: /Pagos/ }).click()
    await expect(page.getByTestId('contas-mostrando')).toContainText(/Mostrando 100 de (\d+)/, { timeout: 20000 })
    await expect(page.getByTestId('contas-carregar-mais')).toBeVisible()

    // filtro sem resultado ≠ empresa sem títulos
    await page.getByRole('button', { name: /Atrasados/ }).click()
    await page.getByPlaceholder(/Buscar por descrição/).fill(`inexistente-${RUN}`)
    await expect(page.getByTestId('contas-vazio')).toContainText('ajuste os filtros', { timeout: 20000 })
  })
})
