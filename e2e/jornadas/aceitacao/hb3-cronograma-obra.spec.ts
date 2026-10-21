// HB3 fatia 2 — tela do cronograma da obra: cria tarefa, liga a predecessora, edita o % e exclui; título/estado vazio.
// Demonstração Comércio (GE); obra de teste cancelada no fim (RD-30). Depende da fatia 1 (#2912) → @pos-migration.

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

  test('estado vazio, criar duas tarefas ligadas, editar % e excluir', { tag: '@pos-migration' }, async ({ page }) => {
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2E-${RUN}`, nome: `E2E cronograma ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto(`/dashboard/projetos/obras/${o.id}/cronograma`)
    await aguardarConteudo(page)
    const tela = page.getByTestId('hub-cronograma-obra')
    await expect(tela.getByTestId('cron-vazio')).toBeVisible({ timeout: 30000 })

    async function criar(nome: string, pred?: string) {
      await tela.getByTestId('cron-nova').click()
      await page.getByTestId('cron-nome').fill(nome)
      await page.getByTestId('cron-inicio').fill('2026-11-10')
      await page.getByTestId('cron-fim').fill('2026-11-20')
      if (pred) await page.getByTestId('cron-pred').selectOption({ label: pred })
      await page.getByTestId('cron-salvar').click()
      await expect(page.getByTestId('cron-form')).toHaveCount(0, { timeout: 30000 })
    }
    await criar(`Terraplenagem ${RUN}`)
    await criar(`Contrapiso ${RUN}`, `Terraplenagem ${RUN}`)
    await expect(tela.getByTestId('cron-tarefa')).toHaveCount(2)
    await expect(tela).toContainText(`Depois de: Terraplenagem ${RUN}`)

    await tela.getByTestId('cron-tarefa').first().getByRole('button', { name: 'Editar' }).click()
    await page.getByTestId('cron-pct').fill('50')
    await page.getByTestId('cron-salvar').click()
    await expect(tela).toContainText('50%', { timeout: 30000 })

    page.once('dialog', (d) => void d.accept())
    await tela.getByTestId('cron-tarefa').last().getByRole('button', { name: 'Excluir' }).click()
    await expect(tela.getByTestId('cron-tarefa')).toHaveCount(1, { timeout: 30000 })
  })
})
