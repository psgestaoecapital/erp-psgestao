// HB2 — De-para serviço PS ↔ código do cliente (/dashboard/projetos/tabelas-preco): o aviso aponta serviço sem código
// e código sem serviço na tabela. Tabela de teste desta execução, desativada no fim (RD-30: nada é apagado).
// Depende das tabelas da migration 20261008170005 → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbInsertMany, dbPatch, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
let tabelaTeste = ''

test.describe('HB2 — de-para serviço × código do cliente', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb2-tabela-preco-depara', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (tabelaTeste) await dbPatch('erp_tabela_preco_cliente', `id=eq.${tabelaTeste}`, { ativo: false }).catch(() => {})
  })

  test('avisa serviço sem código e código sem serviço', { tag: '@pos-migration' }, async ({ page }) => {
    const t = await dbInsert<{ id: string }>('erp_tabela_preco_cliente', { company_id: DEMO, nome: `E2E de-para ${RUN}` })
    tabelaTeste = t.id
    const base = { company_id: DEMO, tabela_id: t.id, unidade: 'm²', faixa_de: 0, faixa_ate: null, preco_base: 20 }
    await dbInsertMany('erp_tabela_preco_item', [
      { ...base, servico_ref: 'pintura-epoxi', servico_nome: 'Pintura Epóxi' },
      { ...base, servico_ref: 'piso-uretano', servico_nome: 'Piso Uretano' },
    ])
    // Epóxi tem código; Uretano não tem (serviço sem código); "selante-x" tem código mas não está na tabela (código sem serviço).
    await dbInsertMany('erp_tabela_preco_codigo', [
      { company_id: DEMO, tabela_id: t.id, servico_ref: 'pintura-epoxi', condicao: 'normal', codigo_externo: 'BRF-001' },
      { company_id: DEMO, tabela_id: t.id, servico_ref: 'selante-x', condicao: 'normal', codigo_externo: 'BRF-999' },
    ])
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)

    await page.goto('/dashboard/projetos/tabelas-preco')
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-tabelas-preco')
    await expect(tela.getByTestId('tp-tabela')).toBeVisible({ timeout: 30000 })
    await tela.getByTestId('tp-tabela').selectOption(t.id)
    const aviso = tela.getByTestId('tp-depara-aviso')
    await expect(aviso).toContainText(/Serviço sem código no cliente:.*Piso Uretano/)
    await expect(aviso).not.toContainText('Pintura Epóxi')
    await expect(aviso).toContainText(/Código sem serviço na tabela:.*selante-x/)
  })
})
