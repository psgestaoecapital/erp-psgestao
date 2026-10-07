// Chamado #1692 (Gean · Jordana, 06/10): ajustes na tela de recebimento de NF (Compras → Documentos recebidos).
//  1) nota concluída sai da tela inicial e fica só na aba "Notas concluídas";
//  2) cada clique na nota aberta (ex.: "gera financeiro") NÃO recarrega a lista com "Carregando…" — a nota aberta
//     continua montada (antes era desmontada/remontada e a tela pulava para o meio);
//  3) nota aberta com fundo mais escuro;
//  4) parcelas só aparecem se algum item estiver marcado "gera financeiro";
//  5) item pode ser recolhido numa linha simples ("resolvido").
// Sem migration: roda no preview. Demonstração Comércio (GE), com uma nota de teste criada aqui e apagada no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const CHAVE = ('4126' + Date.now().toString() + Math.floor(Math.random() * 1e9).toString()).padEnd(44, '7').slice(0, 44)
let nfeId = ''
const itemIds: string[] = []

test.describe('Recebimento fiscal: abas, sem pulo de tela, parcelas e itens recolhidos (#1692)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const n = await dbInsert<{ id: string }>('erp_nfe_recebidas', {
      company_id: DEMO_GE, chave_acesso: CHAVE, numero: '1692', serie: '1', modelo: '55',
      emitente_cnpj: '11222333000181', emitente_razao: `E2E Fornecedor 1692 ${RUN}`,
      data_emissao: new Date().toISOString(), valor_total: 30, valor_produtos: 30,
      status: 'completa', status_manifestacao: 'ciencia',
    })
    nfeId = n.id
    for (const [k, v] of [[1, 10], [2, 20]] as const) {
      const it = await dbInsert<{ id: string }>('erp_nfe_recebidas_itens', {
        nfe_recebida_id: nfeId, company_id: DEMO_GE, numero_item: k, codigo_produto: `E2E-${RUN}-${k}`,
        descricao: `E2E item ${k} ${RUN}`, ncm: '27101932', cfop: '5102', unidade: 'UN',
        quantidade: 1, valor_unitario: v, valor_total: v, gera_financeiro: true,
      })
      itemIds.push(it.id)
    }
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-gean-recebimento-fiscal-ux-1692', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (!nfeId) return
    await dbDelete('erp_nfe_recebidas_itens', `nfe_recebida_id=eq.${nfeId}`).catch(() => {})
    await dbDelete('erp_nfe_recebidas', `id=eq.${nfeId}&company_id=eq.${DEMO_GE}`).catch(() => {})
  })

  test('clicar na nota aberta não remonta a tela; parcelas, recolher e aba de concluídas', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/compras/documentos-recebidos')
    await aguardarConteudo(page)

    // 1) aba "A concluir" é a inicial e mostra a nota não concluída
    await expect(page.getByTestId('nfe-aba-a_concluir')).toHaveAttribute('aria-selected', 'true', { timeout: 20000 })
    const card = page.getByTestId(`nfe-recebida-${nfeId}`)
    await expect(card, 'nota a concluir aparece na tela inicial').toBeVisible({ timeout: 20000 })

    // 3) abrir a nota → fundo mais escuro
    await card.getByRole('button', { name: /^Itens$/ }).click()
    await expect(card).toHaveClass(/bg-\[#F3E9DD\]/)
    const item1 = page.getByTestId(`nfe-item-${itemIds[0]}`)
    await expect(item1).toBeVisible({ timeout: 20000 })
    await expect(card.getByTestId('nfe-parcelas'), 'com itens gerando financeiro, as parcelas aparecem').toBeVisible()

    // 2) marca o nó do item: se a lista recarregar com "Carregando…", o nó é trocado e a marca some
    await item1.evaluate((el) => { (el as HTMLElement & { __marca1692?: boolean }).__marca1692 = true })
    let viuCarregando = false
    const vigia = setInterval(() => { void page.getByText('Carregando…', { exact: true }).count().then((c) => { if (c > 0) viuCarregando = true }).catch(() => {}) }, 50)

    // 4) desmarcar "gera financeiro" nos dois itens → grava no banco e as parcelas somem
    for (const id of itemIds) {
      const cb = page.getByTestId(`nfe-gera-fin-${id}`)
      await cb.uncheck()
      await expect(cb).not.toBeChecked({ timeout: 15000 })
    }
    await expect.poll(async () => (await dbSelect<{ gera_financeiro: boolean }>('erp_nfe_recebidas_itens',
      `nfe_recebida_id=eq.${nfeId}&select=gera_financeiro`)).every((r) => r.gera_financeiro === false), { timeout: 15000 }).toBe(true)
    await expect(card.getByTestId('nfe-parcelas'), 'sem item gerando financeiro, sem parcelas').toHaveCount(0)
    clearInterval(vigia)
    expect(viuCarregando, 'a lista não pode ser trocada por "Carregando…" a cada clique').toBe(false)
    expect(await item1.evaluate((el) => (el as HTMLElement & { __marca1692?: boolean }).__marca1692 === true),
      'o item continua o MESMO nó (não foi desmontado/remontado → a tela não pula)').toBe(true)

    // 5) recolher um item numa linha simples e abrir de novo
    await page.getByTestId(`nfe-recolher-${itemIds[0]}`).click()
    const linha = page.getByTestId(`nfe-item-recolhido-${itemIds[0]}`)
    await expect(linha).toBeVisible()
    await expect(linha).toContainText(`E2E item 1 ${RUN}`)
    await linha.getByRole('button', { name: 'abrir' }).click()
    await expect(page.getByTestId(`nfe-item-${itemIds[0]}`)).toBeVisible()

    // 1) concluída sai da tela inicial e aparece só na aba "Notas concluídas"
    await dbPatch('erp_nfe_recebidas', `id=eq.${nfeId}&company_id=eq.${DEMO_GE}`, { concluida_em: new Date().toISOString() })
    await page.reload()
    await aguardarConteudo(page)
    await expect(page.getByTestId('nfe-aba-a_concluir')).toHaveAttribute('aria-selected', 'true', { timeout: 20000 })
    await expect(page.getByTestId(`nfe-recebida-${nfeId}`), 'concluída não fica na tela inicial').toHaveCount(0)
    await page.getByTestId('nfe-aba-concluidas').click()
    await expect(page.getByTestId(`nfe-recebida-${nfeId}`), 'concluída aparece na aba de concluídas').toBeVisible({ timeout: 20000 })
  })
})
