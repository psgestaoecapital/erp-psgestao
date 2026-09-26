// RD-78 · Aceitação do chamado #71 (KGF · Jordana): "Ao clicar em editar, abrir uma tela IGUAL à de incluir
// despesa/receita, com as mesmas opções, na mesma formatação". O ✏️ da listagem abre a própria tela de inclusão
// (NovaDespesaForm/NovaReceitaForm) em modo edição, preenchida com o lançamento; salvar grava só o que mudou pela
// RPC oficial (fn_*_editar_completo), com trilha no histórico. Título já baixado trava valor/vencimento/conta.
// Roda na Demonstração Comércio (GE), nunca em empresa real. Títulos de teste excluídos (soft) no fim.

import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const hoje = new Date().toISOString().slice(0, 10)

// input/select/textarea logo depois do rótulo do Campo (mesma marcação da inclusão)
const campo = (page: Page, rotulo: string) =>
  page.locator(`xpath=//label[starts-with(normalize-space(.), "${rotulo}")]/following-sibling::*[self::input or self::select or self::textarea or self::div][1]`).first()

async function abrirComoGE(page: Page, url: string) {
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
  await page.goto(url)
  await aguardarConteudo(page)
}

test.describe('Aceitação #71 — editar abre a mesma tela da inclusão', () => {
  const criados: { tabela: string; id: string }[] = []
  let despesa = ''
  let receita = ''
  let receitaPaga = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-71-editar-igual-inclusao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    despesa = (await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, descricao: `Aceitação #71 despesa ${RUN}`, fornecedor_nome: 'Fornecedor Aceitação 71',
      valor: 321.45, data_emissao: hoje, data_vencimento: hoje, status: 'aberto', forma_pagamento: 'pix', observacoes: 'antes',
    })).id
    receita = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, descricao: `Aceitação #71 receita ${RUN}`, cliente_nome: 'Cliente Aceitação 71',
      valor: 654.32, data_emissao: hoje, data_vencimento: hoje, status: 'aberto', forma_pagamento: 'pix', observacoes: 'antes',
    })).id
    receitaPaga = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, descricao: `Aceitação #71 receita paga ${RUN}`, cliente_nome: 'Cliente Aceitação 71',
      valor: 100, valor_pago: 100, data_emissao: hoje, data_vencimento: hoje, data_pagamento: hoje, status: 'pago', forma_pagamento: 'pix',
    })).id
    criados.push({ tabela: 'erp_pagar', id: despesa }, { tabela: 'erp_receber', id: receita }, { tabela: 'erp_receber', id: receitaPaga })
  })

  test.afterAll(async () => {
    for (const c of criados) await dbPatch(c.tabela, `id=eq.${c.id}`, { deleted_at: new Date().toISOString() })
  })

  test('✏️ na lista de despesas abre a tela de inclusão preenchida e salva a alteração', async ({ page }) => {
    await abrirComoGE(page, '/dashboard/financeiro/pagar')
    await page.getByPlaceholder('Buscar por nome, CPF/CNPJ, descrição, documento ou valor').fill(RUN)
    await page.getByRole('button', { name: 'Editar' }).first().click({ timeout: 20000 })

    // a MESMA tela da inclusão: título + os rótulos e listas da "Nova despesa"
    await expect(page.getByRole('heading', { name: 'Editar despesa' })).toBeVisible({ timeout: 20000 })
    for (const r of ['Quanto custa?', 'Quando vence?', 'Para quem você paga?', 'Em qual categoria do DRE?', 'Como você vai pagar?', 'Em qual conta sai o dinheiro?', 'Número do documento (opcional)', 'Código de barras (boleto ou guia)']) {
      await expect(page.getByText(r, { exact: false }).first(), `campo da inclusão: ${r}`).toBeVisible()
    }
    await expect(campo(page, 'Quanto custa?')).toHaveValue('321.45')
    await expect(campo(page, 'O que é essa despesa?')).toHaveValue(`Aceitação #71 despesa ${RUN}`)

    await campo(page, 'Observação').fill('alterado pela tela de inclusão')
    await campo(page, 'Número do documento').fill('NF 71')
    await page.getByTestId('salvar-edicao').click()

    await expect.poll(async () => (await dbSelect<{ observacoes: string | null; numero_documento: string | null; valor: number }>('erp_pagar',
      `id=eq.${despesa}&select=observacoes,numero_documento,valor`))[0], { timeout: 15000 })
      .toMatchObject({ observacoes: 'alterado pela tela de inclusão', numero_documento: 'NF 71' })
    const log = await dbSelect('erp_lancamento_log', `lancamento_id=eq.${despesa}&acao=eq.EDITOU&select=id`)
    expect(log.length, 'a alteração fica no histórico do lançamento').toBeGreaterThan(0)
  })

  test('editar receita abre a tela "Nova receita" preenchida e salva', async ({ page }) => {
    await abrirComoGE(page, `/dashboard/financeiro/nova-receita?editar=${receita}`)
    await expect(page.getByRole('heading', { name: 'Editar receita' })).toBeVisible({ timeout: 20000 })
    for (const r of ['Quanto vou receber?', 'Quando entra na conta?', 'De quem você vai receber?', 'Em qual categoria do DRE?', 'Como você vai receber?', 'Em qual conta entra o dinheiro?', 'Centro de custo (opcional)']) {
      await expect(page.getByText(r, { exact: false }).first(), `campo da inclusão: ${r}`).toBeVisible()
    }
    await expect(campo(page, 'Quanto vou receber?')).toHaveValue('654.32')
    await campo(page, 'Observação').fill('receita alterada')
    await page.getByTestId('salvar-edicao').click()
    await expect.poll(async () => (await dbSelect<{ observacoes: string | null }>('erp_receber', `id=eq.${receita}&select=observacoes`))[0]?.observacoes,
      { timeout: 15000 }).toBe('receita alterada')
  })

  test('trocar o fornecedor na edição grava o VÍNCULO (fornecedor cadastrado), não só o nome @pos-migration', async ({ page }) => {
    const [forn] = await dbSelect<{ id: string }>('erp_fornecedores', `company_id=eq.${DEMO_COMERCIO}&ativo=eq.true&select=id&limit=1`)
    expect(forn, 'a demo tem fornecedor cadastrado').toBeTruthy()
    await abrirComoGE(page, `/dashboard/financeiro/nova-despesa?editar=${despesa}`)
    await expect(page.getByRole('heading', { name: 'Editar despesa' })).toBeVisible({ timeout: 20000 })
    await campo(page, 'Para quem você paga?').selectOption(forn.id)
    await page.getByTestId('salvar-edicao').click()
    await expect.poll(async () => (await dbSelect<{ fornecedor_id: string | null }>('erp_pagar', `id=eq.${despesa}&select=fornecedor_id`))[0]?.fornecedor_id,
      { timeout: 15000 }).toBe(forn.id)
  })

  test('título já recebido: valor, vencimento e conta ficam travados na edição', async ({ page }) => {
    await abrirComoGE(page, `/dashboard/financeiro/nova-receita?editar=${receitaPaga}`)
    await expect(page.getByRole('heading', { name: 'Editar receita' })).toBeVisible({ timeout: 20000 })
    await expect(campo(page, 'Quanto vou receber?')).toBeDisabled()
    await expect(campo(page, 'Quando entra na conta?')).toBeDisabled()
    await expect(page.getByTestId('edicao-situacao')).toContainText('Recebida')
  })
})
