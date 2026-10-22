// HB1 — Lançar horas na obra (/dashboard/projetos/obras/[id]/horas), gravando por fn_obra_mao_obra_apontar/_excluir (#2687).
// Demonstração Comércio (GE), obra de teste desta execução: lança 2 h × R$ 50 → total R$ 100,00 na tela e em
// v_obra_resultado_alocado.custo_mao_obra; exclui (exclusão lógica) → total some e a view volta a zero.
// A obra de teste fica cancelada no fim (RD-30). Depende das funções/view da #2687 e da migration de ajuda → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbPatch, dbSelect, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
let obraTeste = ''

test.describe('HB1 — lançar horas na obra', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb1-lancar-horas-obra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (obraTeste) await dbPatch('projetos_obras', `id=eq.${obraTeste}`, { status: 'cancelada', observacoes: 'e2e — obra de teste encerrada' }).catch(() => {})
  })

  test('lançar → total → custo na view alocada → excluir', { tag: '@pos-migration' }, async ({ page }) => {
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2E-H${RUN}`, nome: `E2E horas ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    page.on('dialog', (d) => void d.accept())

    await page.goto(`/dashboard/projetos/obras/${o.id}/horas`)
    await aguardarConteudo(page)
    await expect(page.getByTestId('horas-vazio')).toBeVisible({ timeout: 30000 })

    await page.getByTestId('horas-horas').fill('2')
    await page.getByTestId('horas-custo').fill('50')
    await page.getByTestId('horas-descricao').fill(`E2E ${RUN}`)
    await page.getByTestId('horas-lancar').click()
    await expect(page.getByTestId('horas-total')).toContainText(/100,00/, { timeout: 30000 })

    const v1 = await dbSelect<{ custo_mao_obra: number }>('v_obra_resultado_alocado', `obra_id=eq.${o.id}&select=custo_mao_obra`)
    expect(Number(v1[0]?.custo_mao_obra ?? 0)).toBe(100)

    await page.getByTestId('horas-excluir').first().click()
    await expect(page.getByTestId('horas-vazio')).toBeVisible({ timeout: 30000 })
    const v2 = await dbSelect<{ custo_mao_obra: number }>('v_obra_resultado_alocado', `obra_id=eq.${o.id}&select=custo_mao_obra`)
    expect(Number(v2[0]?.custo_mao_obra ?? 0)).toBe(0)
  })
})
