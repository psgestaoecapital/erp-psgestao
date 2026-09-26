// RD-83 · CAMINHO PRINCIPAL da tela Financeiro → Contas a Pagar (listagem), entregue com a correção de
// contas a pagar (defeito do #38). Abrir a listagem, achar a despesa, "Marcar pago" (parcial) e conferir no banco;
// depois o ✏️ da própria linha abre a MESMA tela da inclusão (#71) e salva a alteração.
// Não depende de migration nova (roda no preview da PR) e entra na varredura semanal em produção.
// Demonstração Comércio (GE, plano Pró), nunca empresa real. Despesa de teste excluída (soft) no fim.

import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const hoje = new Date().toISOString().slice(0, 10)
const DESCRICAO = `Caminho pagar ${RUN}`

const campo = (page: Page, rotulo: string) =>
  page.locator(`xpath=//label[starts-with(normalize-space(.), "${rotulo}")]/following-sibling::*[self::input or self::select or self::textarea][1]`).first()

test.describe('Caminho principal — Contas a Pagar: marcar pago e editar pela listagem', () => {
  let despesa = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-financeiro-pagar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)
    despesa = (await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, descricao: DESCRICAO, fornecedor_nome: 'Fornecedor Caminho', valor: 800,
      data_emissao: hoje, data_vencimento: hoje, status: 'aberto', forma_pagamento: 'pix',
    })).id
  })

  test.afterAll(async () => {
    if (despesa) await dbPatch('erp_pagar', `id=eq.${despesa}`, { deleted_at: new Date().toISOString() })
  })

  test('achar a despesa, marcar R$ 300 pago e editar pelo ✏️ → tudo gravado no banco', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/financeiro/pagar')
    await aguardarConteudo(page)

    await page.getByPlaceholder('Buscar por nome, CPF/CNPJ, descrição, documento ou valor').fill(RUN)
    const linha = page.locator('tr', { hasText: DESCRICAO })
    await expect(linha, 'a despesa aparece na listagem').toBeVisible({ timeout: 20000 })

    // Marcar pago (parcial)
    await linha.getByRole('button', { name: 'Marcar pago' }).click()
    await expect(page.getByRole('heading', { name: 'Marcar como pago' })).toBeVisible()
    await page.getByLabel('Valor pago (R$)').fill('300')   // o Field do modal envolve o input no <label>
    await page.getByRole('button', { name: 'Confirmar' }).click()
    await expect.poll(async () => (await dbSelect<{ valor_pago: number; status: string }>('erp_pagar', `id=eq.${despesa}&select=valor_pago,status`))[0],
      { timeout: 20000 }).toMatchObject({ status: 'parcial' })
    expect(Number((await dbSelect<{ valor_pago: number }>('erp_pagar', `id=eq.${despesa}&select=valor_pago`))[0].valor_pago)).toBe(300)

    // ✏️ da própria linha abre a tela da inclusão (#71) e salva
    await linha.getByRole('button', { name: 'Editar' }).click()
    await expect(page.getByRole('heading', { name: 'Editar despesa' })).toBeVisible({ timeout: 20000 })
    await campo(page, 'Observação').fill('editado pela listagem')
    await page.getByTestId('salvar-edicao').click()
    await expect.poll(async () => (await dbSelect<{ observacoes: string | null }>('erp_pagar', `id=eq.${despesa}&select=observacoes`))[0]?.observacoes,
      { timeout: 15000 }).toBe('editado pela listagem')
    expect(Number((await dbSelect<{ valor_pago: number }>('erp_pagar', `id=eq.${despesa}&select=valor_pago`))[0].valor_pago),
      'editar não mexe no que já foi pago').toBe(300)
  })
})
