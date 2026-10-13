// Pdois #144 (CEO 01/10): formulário do Job na ordem do SIGA — Cliente → Peça/tipo → Título (campo grande) → Prazo →
// Responsável → Briefing (área grande, por último). Sem migration: roda no preview.
// Na Agência (P&M) - DEMO, pela tela: abre "Novo job", confere a ordem dos campos NA TELA (posição de cada um) e cria
// um job com a peça "Post de rede social". O job de teste vai para a lixeira da Pauta no fim (exclusão lógica,
// restaurável — nada apagado, RD-30), para não sujar a Pauta da demonstração a cada execução (PM-A, 02/10).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbPatch, dbSelect, registrarJornada } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const RUN = Date.now().toString(36).toUpperCase()
const TITULO = `E2E Post Dia das Crianças ${RUN}`

test.describe('Pdois #144 · formulário do Job na ordem do SIGA', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pdois-job-ordem-144', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    await dbPatch('agency_jobs', `company_id=eq.${DEMO_AG}&titulo=eq.${encodeURIComponent(TITULO)}`, { status: 'concluida', excluido_em: new Date().toISOString() }).catch(() => {})
  })

  test('Cliente → Peça → Título → Prazo → Responsável → Briefing, e o job grava a peça', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AG)
    await page.goto('/dashboard/producao')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: '+ Novo job' }).first().click()

    const campos = {
      cliente: page.getByTestId('job-cliente'),
      tipo: page.getByTestId('job-tipo'),
      titulo: page.getByTestId('job-titulo'),
      prazo: page.getByTestId('job-prazo'),
      responsavel: page.getByTestId('job-responsavel'),
      briefing: page.getByPlaceholder('Descreva o job para quem vai executar', { exact: false }),
    }
    for (const c of Object.values(campos)) await expect(c).toBeVisible()
    const y = async (k: keyof typeof campos) => (await campos[k].boundingBox())!.y
    const x = async (k: keyof typeof campos) => (await campos[k].boundingBox())!.x
    expect(await y('cliente'), 'Cliente é o primeiro').toBeLessThan(await y('tipo'))
    expect(await y('tipo'), 'Peça antes do Título').toBeLessThan(await y('titulo'))
    expect(await y('titulo'), 'Título antes do Prazo').toBeLessThan(await y('prazo'))
    // Prazo e Responsável dividem a linha (ou o Responsável vem logo abaixo, em tela estreita)
    expect((await y('prazo')) < (await y('responsavel')) || (await x('prazo')) < (await x('responsavel')), 'Prazo antes do Responsável').toBe(true)
    expect(await y('responsavel'), 'Briefing por último').toBeLessThan(await y('briefing'))
    expect(await campos.titulo.evaluate((el) => el.tagName), 'Título é campo grande').toBe('TEXTAREA')

    await campos.tipo.selectOption('post_rede_social')
    await campos.titulo.fill(TITULO)
    await campos.prazo.fill('2026-10-12')
    await campos.briefing.fill('Carrossel com 3 cards, paleta da marca.')
    await page.getByRole('button', { name: 'CRIAR' }).click()

    await expect.poll(async () => (await dbSelect<{ tipo: string | null; data_prazo: string | null }>('agency_jobs',
      `company_id=eq.${DEMO_AG}&titulo=eq.${encodeURIComponent(TITULO)}&select=tipo,data_prazo`))[0]?.tipo ?? null,
      { timeout: 15000, message: 'o job foi gravado com a peça' }).toBe('post_rede_social')
  })
})
