// HB3 fatia 5 — jornada do cronograma da obra (/dashboard/projetos/obras/[id]/cronograma).
// Demonstração Comércio (GE), obra de teste desta execução, sem tarefas: estado vazio com próximo passo → criar duas
// tarefas (a 2ª depende da 1ª) → indicadores → fixar linha de base → editar → excluir. A obra de teste fica cancelada
// no fim (RD-30: nada é apagado). As funções fn_obra_tarefa_* já estão em produção (fatia 1).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbPatch, dbSelect, registrarJornada } from '../../support/api'

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

  test('estado vazio → duas tarefas com dependência → linha de base → editar → excluir', async ({ page }) => {
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2E-${RUN}`, nome: `E2E cronograma ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    page.on('dialog', (d) => { void d.accept() })

    await page.goto(`/dashboard/projetos/obras/${o.id}/cronograma`)
    await aguardarConteudo(page)
    await expect(page.getByText('Esta obra ainda não tem cronograma')).toBeVisible({ timeout: 30000 })

    const criar = async (nome: string, inicio: string, fim: string, predecessora?: string) => {
      await page.getByRole('button', { name: 'Nova tarefa' }).click()
      await page.getByLabel('Nome da tarefa').fill(nome)
      await page.getByLabel('Início').fill(inicio)
      await page.getByLabel('Fim').fill(fim)
      if (predecessora) await page.getByLabel('Depende de').selectOption({ label: predecessora })
      await page.getByRole('button', { name: 'Salvar tarefa' }).click()
      await expect(page.getByRole('status')).toContainText('Tarefa salva.', { timeout: 30000 })
    }
    await criar(`Fundação ${RUN}`, '2026-11-02', '2026-11-13')
    await criar(`Estrutura ${RUN}`, '2026-11-16', '2026-11-30', `Fundação ${RUN}`)
    await expect(page.getByText(`após Fundação ${RUN}`)).toBeVisible()

    const dep = await dbSelect('projetos_obra_tarefa', `obra_id=eq.${o.id}&excluido_em=is.null&select=id`)
    expect(dep).toHaveLength(2)

    await page.getByRole('button', { name: 'Fixar linha de base' }).click()
    await expect(page.getByRole('status')).toContainText('Linha de base fixada.', { timeout: 30000 })
    const base = await dbSelect('projetos_obra_tarefa', `obra_id=eq.${o.id}&excluido_em=is.null&fim_base=not.is.null&select=id`)
    expect(base).toHaveLength(2)

    await page.getByRole('button', { name: 'Editar' }).nth(1).click()
    await page.getByLabel('Avanço (%)').fill('50')
    await page.getByLabel('Fim').fill('2026-12-04')
    await page.getByRole('button', { name: 'Salvar tarefa' }).click()
    await expect(page.getByText('50%').first()).toBeVisible({ timeout: 30000 })
    // fim depois da linha de base → "Fora da linha de base" = 1
    await expect(page.getByText('Fora da linha de base').locator('..').getByText('1', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Excluir' }).nth(1).click()
    await expect(page.getByRole('status')).toContainText('Tarefa excluída.', { timeout: 30000 })
    const resta = await dbSelect('projetos_obra_tarefa', `obra_id=eq.${o.id}&excluido_em=is.null&select=id`)
    expect(resta).toHaveLength(1)
  })
})
