// HB1 — Lançar horas na obra (/dashboard/projetos/obras/[id]/horas), gravando por fn_obra_mao_obra_apontar/_excluir (#2687).
// Demonstração Comércio (GE), obra de teste desta execução: lança 2 h × R$ 50 → total R$ 100,00 na tela e em
// v_obra_resultado_alocado.custo_mao_obra; exclui (exclusão lógica) → total some e a view volta a zero.
// A obra de teste fica cancelada no fim (RD-30). Depende das funções/view da #2687 e da migration de ajuda → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbPatch, dbDelete, dbSelect, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
let obraTeste = ''
let obraTeste2 = ''
let equipeTeste = ''
let membroTeste = ''

test.describe('HB1 — lançar horas na obra', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hb1-lancar-horas-obra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (obraTeste) await dbPatch('projetos_obras', `id=eq.${obraTeste}`, { status: 'cancelada', observacoes: 'e2e — obra de teste encerrada' }).catch(() => {})
    if (obraTeste2) await dbPatch('projetos_obras', `id=eq.${obraTeste2}`, { status: 'cancelada', observacoes: 'e2e — obra de teste encerrada' }).catch(() => {})
    if (membroTeste) await dbDelete('projetos_equipe_membro', `id=eq.${membroTeste}`).catch(() => {})
    if (equipeTeste) await dbDelete('projetos_equipe', `id=eq.${equipeTeste}`).catch(() => {})
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
    // #6874: custo/hora agora é campo com máscara de R$ (CampoMoeda, centavos). "5000" dígitos → R$ 50,00.
    await page.getByTestId('horas-custo').fill('5000')
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

  // Ponto da obra POR COLABORADOR (blueprint 327 / 37de7d98): atribui as horas a um membro da equipe e a lista mostra o nome.
  test('ponto por colaborador — atribui o membro da equipe e exibe o nome', { tag: '@pos-migration' }, async ({ page }) => {
    const nome = `E2E João ${RUN}`
    const eq = await dbInsert<{ id: string }>('projetos_equipe', { company_id: DEMO, nome: `E2E equipe ${RUN}`, ativo: true })
    equipeTeste = eq.id
    const mb = await dbInsert<{ id: string }>('projetos_equipe_membro', { equipe_id: eq.id, company_id: DEMO, nome_pessoa: nome, custo_hora: 50 })
    membroTeste = mb.id
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2E-M${RUN}`, nome: `E2E ponto membro ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste2 = o.id

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    page.on('dialog', (d) => void d.accept())

    await page.goto(`/dashboard/projetos/obras/${o.id}/horas`)
    await aguardarConteudo(page)
    await expect(page.getByTestId('horas-vazio')).toBeVisible({ timeout: 30000 })

    // Escolher o colaborador traz o custo da hora dele (R$ 50,00); só informo as horas.
    await page.getByTestId('horas-membro').selectOption({ label: nome })
    await expect(page.getByTestId('horas-custo')).toHaveValue(/50,00/, { timeout: 10000 })
    await page.getByTestId('horas-horas').fill('3')
    await page.getByTestId('horas-lancar').click()

    // A lista mostra o nome do colaborador e o total 3 × 50 = R$ 150,00.
    await expect(page.getByTestId('horas-col-membro').first()).toContainText(nome, { timeout: 30000 })
    await expect(page.getByTestId('horas-total')).toContainText(/150,00/, { timeout: 30000 })

    // Gravou o membro_id no banco (RD-38).
    const linhas = await dbSelect<{ membro_id: string }>('projetos_obra_mao_obra_apontamento', `obra_id=eq.${o.id}&excluido_em=is.null&select=membro_id`)
    expect(linhas.some(l => l.membro_id === mb.id)).toBe(true)
  })
})
