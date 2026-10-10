// HB2 fatia 2 — Tabela de preço por cliente (/dashboard/projetos/tabelas-preco): faixa de quantidade + adicional por turno.
// Demonstração Comércio (GE): tabela de teste desta execução; 350 m² no sábado cai na faixa 100–500 (R$ 20,00) × 1,5 = R$ 30,00
// e a margem sai contra o custo informado. A tabela de teste é desativada no fim (RD-30: nada é apagado).
// Depende das tabelas da migration 20261008170005 → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbInsertMany, dbPatch, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
let tabelaTeste = ''

test.describe('HB2 — tabela de preço por cliente', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb2-tabela-preco', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (tabelaTeste) await dbPatch('erp_tabela_preco_cliente', `id=eq.${tabelaTeste}`, { ativo: false }).catch(() => {})
  })

  test('350 m² no sábado: faixa 100–500 × 1,5 e margem contra o custo', { tag: '@pos-migration' }, async ({ page }) => {
    const t = await dbInsert<{ id: string }>('erp_tabela_preco_cliente', { company_id: DEMO, nome: `E2E tabela ${RUN}` })
    tabelaTeste = t.id
    const base = { company_id: DEMO, tabela_id: t.id, servico_ref: 'pintura-epoxi', servico_nome: 'Pintura Epóxi', unidade: 'm²' }
    await dbInsertMany('erp_tabela_preco_item', [
      { ...base, faixa_de: 0, faixa_ate: 100, preco_base: 25 },
      { ...base, faixa_de: 100, faixa_ate: 500, preco_base: 20 },
      { ...base, faixa_de: 500, faixa_ate: null, preco_base: 15 },
    ])
    await dbInsertMany('erp_tabela_preco_condicao', [
      { company_id: DEMO, tabela_id: t.id, condicao: 'sabado', percentual: 50 },
    ])
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)

    await page.goto('/dashboard/projetos/tabelas-preco')
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-tabelas-preco')
    await expect(tela.getByTestId('tp-tabela')).toBeVisible({ timeout: 30000 })
    await tela.getByTestId('tp-tabela').selectOption(t.id)
    await tela.getByTestId('tp-servico').selectOption('pintura-epoxi')
    await tela.getByTestId('tp-qtd').fill('350')
    await tela.getByTestId('tp-cond').selectOption('sabado')
    await expect(tela.getByTestId('tp-preco')).toContainText(/30,00/)
    await tela.getByTestId('tp-custo').fill('20')
    await expect(tela.getByTestId('tp-margem')).toContainText('33,3%')
  })
})
