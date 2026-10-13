// Virada FCR (CEO 29/09) · a FCR já tem 21 títulos a receber. Na importação da migração financeira, um título igual
// a um que já existe (mesma pessoa, valor e vencimento) aparece como "já existe" na conferência e NÃO é importado.
// Demonstração Comércio: a planilha traz 1 título que já está no sistema + 1 novo. Só a conferência — o teste NÃO
// clica em importar (nada é gravado). Só frontend: roda no preview.

import * as XLSX from 'xlsx'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

test.describe('Importação da migração financeira — título que já existe não entra de novo', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-importador-ja-existe', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('planilha com 1 título existente + 1 novo: conferência mostra "já existe" e importa só 1', async ({ page }, testInfo) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)

    const existentes = await dbSelect<{ cliente_nome: string; valor: number | string; data_vencimento: string; status: string | null }>('erp_receber',
      `company_id=eq.${DEMO_COMERCIO}&deleted_at=is.null&cliente_nome=not.is.null&status=neq.cancelado&select=cliente_nome,valor,data_vencimento,status&order=data_vencimento.desc&limit=1`)
    const ex = existentes[0]
    expect(ex, 'a demonstração tem título a receber').toBeTruthy()

    // mesmo título, escrito diferente (minúsculas) — tem de casar; e um título novo, com valor/data que não existem
    const linhas = [
      ['Tipo *', 'Valor *', 'Vencimento *', 'Cliente/Fornecedor', 'Descrição', 'Categoria (código)'],
      ['receber', brl(Number(ex.valor)), dataBR(ex.data_vencimento), ex.cliente_nome.toLowerCase(), 'E2E título que já existe', ''],
      ['receber', '9.876,53', '28/02/2031', 'E2E CLIENTE NOVO', 'E2E título novo', ''],
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), 'Financeiro')
    const arquivo = testInfo.outputPath('migracao-ja-existe.xlsx')
    XLSX.writeFile(wb, arquivo)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/importar-universal')
    await aguardarConteudo(page)

    const card = page.locator('section', { hasText: 'Importar em massa · migração financeira' })
    await expect(card).toBeVisible({ timeout: 20000 })
    await card.locator('input[type="file"]').setInputFiles(arquivo)

    await expect(page.getByTestId('import-resumo'), 'conferência mostra o já existente').toContainText('1 já existe(m) no sistema', { timeout: 20000 })
    await expect(page.locator('[data-testid="import-linha"][data-status="ja_existe"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="import-linha"][data-status="ja_existe"]')).toContainText('Já existe no sistema')
    await expect(card.getByRole('button', { name: /Importar 1 lançamento/ }), 'só o novo será importado').toBeVisible()
  })
})
