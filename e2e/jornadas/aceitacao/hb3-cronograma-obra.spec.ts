// HB3 fatia 2 — cronograma da obra (/dashboard/projetos/obras/[id]/cronograma). Demonstração Comércio (GE), obra de teste:
// vazio mostra o próximo passo; criar tarefa pela tela aparece na lista; a obra de teste fica cancelada no fim (RD-30).
// Depende das funções da migration 20261020170030 → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
let obraTeste = ''

test.describe('HB3 — cronograma da obra', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb3-cronograma-obra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (obraTeste) await dbPatch('projetos_obras', `id=eq.${obraTeste}`, { status: 'cancelada', observacoes: 'e2e — obra de teste encerrada' }).catch(() => {})
  })

  test('obra vazia orienta; nova tarefa aparece no cronograma', { tag: '@pos-migration' }, async ({ page }) => {
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2E-C${RUN}`, nome: `E2E cronograma ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)

    await page.goto(`/dashboard/projetos/obras/${o.id}/cronograma`)
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-cronograma-obra')
    await expect(tela.getByText('Esta obra ainda não tem cronograma')).toBeVisible()

    await tela.getByTestId('crono-nova').click()
    await tela.getByTestId('crono-nome').fill(`Forro ${RUN}`)
    await tela.getByTestId('crono-inicio').fill('2026-11-03')
    await tela.getByTestId('crono-fim').fill('2026-11-14')
    await tela.getByTestId('crono-pct').fill('40')
    await tela.getByTestId('crono-salvar').click()
    await expect(tela.getByTestId('crono-linha').filter({ hasText: `Forro ${RUN}` })).toBeVisible()
    await expect(tela.getByText('Avanço físico ponderado: 40%')).toBeVisible()
  })
})
