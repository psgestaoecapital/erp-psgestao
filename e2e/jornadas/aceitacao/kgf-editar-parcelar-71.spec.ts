// RD-78 · Aceitação do chamado #71 (Jordana, 02/10): "não existe opção de parcelamento na edição (lancei o valor
// total no PIX mas o cliente pediu em duas vezes no boleto)". Na edição de uma receita EM ABERTO aparece o atalho
// "Parcelar / mudar a forma de recebimento", que abre o Acerto/Renegociação já com o título marcado (o acerto troca
// o título por N parcelas, cada uma com a sua forma, e fica rastreável/desfazível). Título já recebido não oferece.
// Roda na Demonstração Comércio (GE), nunca em empresa real. Títulos de teste excluídos (soft) no fim.

import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const hoje = new Date().toISOString().slice(0, 10)

async function abrirComoGE(page: Page, url: string) {
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
  await page.goto(url)
  await aguardarConteudo(page)
}

test.describe('Aceitação #71 — parcelar/mudar a forma a partir da edição', () => {
  const criados: string[] = []
  let receita = ''
  let receitaPaga = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-71-editar-parcelar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    receita = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, descricao: `Aceitação #71 parcelar ${RUN}`, cliente_nome: 'Cliente Aceitação 71',
      valor: 800, data_emissao: hoje, data_vencimento: hoje, status: 'aberto', forma_pagamento: 'pix',
    })).id
    receitaPaga = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, descricao: `Aceitação #71 parcelar paga ${RUN}`, cliente_nome: 'Cliente Aceitação 71',
      valor: 100, valor_pago: 100, data_emissao: hoje, data_vencimento: hoje, data_pagamento: hoje, status: 'pago', forma_pagamento: 'pix',
    })).id
    criados.push(receita, receitaPaga)
  })

  test.afterAll(async () => {
    for (const id of criados) await dbPatch('erp_receber', `id=eq.${id}`, { deleted_at: new Date().toISOString() })
  })

  test('receita em aberto: o atalho abre o Acerto com o título já marcado', async ({ page }) => {
    await abrirComoGE(page, `/dashboard/financeiro/nova-receita?editar=${receita}`)
    await expect(page.getByRole('heading', { name: 'Editar receita' })).toBeVisible({ timeout: 20000 })
    const atalho = page.getByTestId('edicao-parcelar').getByRole('link', { name: /Parcelar \/ mudar a forma/ })
    await expect(atalho).toBeVisible()
    await atalho.click()

    await expect(page).toHaveURL(new RegExp(`/dashboard/financeiro/renegociacao\\?titulo=${receita}`), { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'Renegociação / Acerto' })).toBeVisible({ timeout: 20000 })
    const linha = page.locator('label', { hasText: `Aceitação #71 parcelar ${RUN}` })
    await expect(linha.getByRole('checkbox')).toBeChecked({ timeout: 20000 })
    await expect(page.getByText(/Selecionado: R\$\s?800,00 · 1 título\(s\)/)).toBeVisible()
  })

  test('receita já recebida: não oferece parcelar', async ({ page }) => {
    await abrirComoGE(page, `/dashboard/financeiro/nova-receita?editar=${receitaPaga}`)
    await expect(page.getByRole('heading', { name: 'Editar receita' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('edicao-situacao')).toContainText('Recebida')
    await expect(page.getByTestId('edicao-parcelar')).toHaveCount(0)
  })
})
