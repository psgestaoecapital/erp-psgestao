// #135 (Triches) · modelo de atendimento da Oficina por empresa (erp_oficina_parametros.modelo_atendimento).
//  - "tablet" (padrão, nada muda): Diagnóstico sem preço; o valor entra na Aprovação do Cliente.
//  - "centralizado" (sem tablet no box): a atendente já lança o preço no Diagnóstico e a Aprovação só mostra o
//    valor (somente leitura) e registra a decisão. Migration 20260927220000.
// Caminho oficial (as telas) numa OS criada pelo teste na Demonstração Oficina; o modelo volta a "tablet" no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = `${Date.now().toString(36)}`
const NUMERO = `CEN-${RUN}`
const ITEM = `Revisão de freio ${RUN}`

test.describe('Modelo de atendimento da Oficina (#135)', () => {
  test.describe.configure({ mode: 'serial' })
  let osId = ''
  let itemId = ''

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    osId = (await dbInsert<{ id: string }>('erp_os', {
      company_id: DEMO_OFICINA, numero: NUMERO, descricao_servico: 'Atendimento de teste (#135)', status: 'aberta',
      cliente_nome: 'Cliente teste #135', placa: 'TST1B35', marca: 'Teste', modelo: 'Centralizado',
    })).id
    itemId = (await dbInsert<{ id: string }>('erp_os_diagnostico_item', {
      company_id: DEMO_OFICINA, os_id: osId, descricao: ITEM, tipo: 'servico', quantidade: 1, severidade: 'recomendado',
    })).id
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-oficina-atendimento-centralizado', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    const limpar = async (f: () => Promise<void>) => { await f().catch(() => {}) }
    // a demo volta ao padrão (antes da migration a coluna não existe — o patch falha calado)
    await limpar(() => dbPatch('erp_oficina_parametros', `company_id=eq.${DEMO_OFICINA}`, { modelo_atendimento: 'tablet' }))
    if (!osId) return
    await limpar(() => dbDelete('erp_os_aprovacao', `os_id=eq.${osId}`))
    await limpar(() => dbDelete('erp_os_diagnostico_item', `os_id=eq.${osId}`))
    await limpar(() => dbDelete('erp_os', `id=eq.${osId}`))
    const resta = await dbSelect<{ id: string }>('erp_os', `id=eq.${osId}&select=id`).catch(() => [])
    if (resta.length) await limpar(() => dbPatch('erp_os', `id=eq.${osId}`, { excluida: true }))
  })

  test('padrão (tablet): Diagnóstico sem preço e o valor é digitado na Aprovação', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/diagnostico')
    await aguardarConteudo(page)
    await page.getByText(NUMERO).first().click()
    await expect(page.getByTestId('diag-item-qtd').first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('diag-item-preco')).toHaveCount(0)

    await page.goto('/dashboard/oficina/aprovacao')
    await aguardarConteudo(page)
    await page.getByText(NUMERO).first().click()
    await expect(page.getByText(ITEM)).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('aprov-item-preco')).toBeEditable()
    await expect(page.getByTestId('aprov-item-preco-fixo')).toHaveCount(0)
  })

  test('centralizado: o preço entra no Diagnóstico e a Aprovação só mostra o valor', { tag: '@pos-migration' }, async ({ page }) => {
    await dbPatch('erp_oficina_parametros', `company_id=eq.${DEMO_OFICINA}`, { modelo_atendimento: 'centralizado' })

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/diagnostico')
    await aguardarConteudo(page)
    await page.getByText(NUMERO).first().click()
    const preco = page.getByTestId('diag-item-preco')
    await expect(preco).toBeVisible({ timeout: 20000 })
    await preco.fill('85,50')
    await page.getByRole('button', { name: 'Salvar laudo' }).click()
    await expect(page.getByText(/Laudo salvo/)).toBeVisible({ timeout: 15000 })

    const [it] = await dbSelect<{ preco: number | null }>('erp_os_diagnostico_item', `id=eq.${itemId}&select=preco`)
    expect(Number(it?.preco), 'preço unitário gravado pelo Diagnóstico').toBe(85.5)

    await page.goto('/dashboard/oficina/aprovacao')
    await aguardarConteudo(page)
    await page.getByText(NUMERO).first().click()
    await expect(page.getByText(ITEM)).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('aprov-item-preco')).not.toBeEditable()
    await expect(page.getByTestId('aprov-item-preco-fixo')).toBeVisible()
  })
})
