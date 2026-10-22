// HB3 fatia 5 — jornada do cronograma da obra (/dashboard/projetos/obras/[id]/cronograma).
// Demonstração Comércio (GE), obra de teste desta execução: estado vazio → duas tarefas (a segunda depende da primeira)
// → indicadores → linha de base → exclusão. A obra de teste fica cancelada no fim (RD-30: nada é apagado).
// Depende das funções fn_obra_tarefa_* das migrations HB3 → @pos-migration.

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

  test('vazio → duas tarefas com dependência → linha de base → excluir', { tag: '@pos-migration' }, async ({ page }) => {
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2E-${RUN}`, nome: `E2E cronograma ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    page.on('dialog', (d) => { void d.accept() })

    await page.goto(`/dashboard/projetos/obras/${o.id}/cronograma`)
    await aguardarConteudo(page)
    await expect(page.getByText('Esta obra ainda não tem cronograma')).toBeVisible({ timeout: 30000 })

    const nova = async (nome: string, ini: string, fim: string, pct: string, depende?: string) => {
      await page.getByRole('button', { name: 'Nova tarefa' }).click()
      await page.getByLabel(/Nome da tarefa/).fill(nome)
      await page.getByLabel(/Início/).fill(ini)
      await page.getByLabel(/^Fim/).fill(fim)
      await page.getByLabel(/Avanço \(%\)/).fill(pct)
      if (depende) await page.getByLabel(/Depende de/).selectOption({ label: depende })
      await page.getByRole('button', { name: 'Salvar tarefa' }).click()
      await expect(page.getByRole('status')).toContainText('Tarefa salva.', { timeout: 30000 })
    }
    await nova(`Fundação ${RUN}`, '2030-01-01', '2030-01-10', '100')
    await nova(`Alvenaria ${RUN}`, '2030-01-11', '2030-01-20', '0', `Fundação ${RUN}`)

    await expect(page.getByText(`após Fundação ${RUN}`)).toBeVisible()
    await expect(page.getByText('Tarefas', { exact: false }).first()).toBeVisible()
    await expect(page.getByText(/^Avanço geral/i)).toBeVisible()

    await page.getByRole('button', { name: 'Fixar linha de base' }).click()
    await expect(page.getByRole('status')).toContainText('Linha de base fixada.', { timeout: 30000 })

    await page.getByRole('button', { name: 'Excluir' }).last().click()
    await expect(page.getByRole('status')).toContainText('Tarefa excluída.', { timeout: 30000 })
    await expect(page.getByText(`Alvenaria ${RUN}`)).toHaveCount(0)
    await expect(page.getByText(`Fundação ${RUN}`)).toBeVisible()
  })
})
