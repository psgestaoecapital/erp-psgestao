// RD-83 · CAMINHO PRINCIPAL da tela Financeiro → Contas a Receber (entregue com o #88): abrir a listagem, achar a
// receita, "Marcar recebido" parcial e conferir no banco. Sem migration: roda no preview.
// Demonstração Comércio (GE), nunca empresa real. Receita de teste excluída (soft) no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const hoje = new Date().toISOString().slice(0, 10)
const DESCRICAO = `Caminho receber ${RUN}`

test.describe('Caminho principal — Contas a Receber: marcar recebido pela listagem', () => {
  let receita = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-financeiro-receber', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)
    receita = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, descricao: DESCRICAO, cliente_nome: 'Cliente Caminho', valor: 600,
      data_emissao: hoje, data_vencimento: hoje, status: 'aberto', forma_pagamento: 'pix',
    })).id
  })

  test.afterAll(async () => {
    if (receita) await dbPatch('erp_receber', `id=eq.${receita}`, { deleted_at: new Date().toISOString() })
  })

  test('achar a receita e marcar R$ 200 recebido → gravado no banco', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/financeiro/receber')
    await aguardarConteudo(page)

    await page.getByPlaceholder('Buscar por nome, CPF/CNPJ, descrição, documento ou valor').fill(RUN)
    const linha = page.locator('tr', { hasText: DESCRICAO })
    await expect(linha, 'a receita aparece na listagem').toBeVisible({ timeout: 20000 })

    await linha.getByRole('button', { name: 'Marcar recebido' }).click()
    await expect(page.getByRole('heading', { name: 'Marcar como recebido' })).toBeVisible()
    await page.getByLabel(/Valor (pago|recebido) \(R\$\)/).fill('200')
    await page.getByRole('button', { name: 'Confirmar' }).click()
    await expect.poll(async () => (await dbSelect<{ status: string }>('erp_receber', `id=eq.${receita}&select=status`))[0]?.status,
      { timeout: 20000 }).toBe('parcial')
    expect(Number((await dbSelect<{ valor_pago: number }>('erp_receber', `id=eq.${receita}&select=valor_pago`))[0].valor_pago)).toBe(200)
  })
})
