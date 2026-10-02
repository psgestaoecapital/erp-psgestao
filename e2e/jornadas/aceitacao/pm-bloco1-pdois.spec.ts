// P&M Bloco 1 — correções da Pdois em teste (CEO 02/10). Migration 20261002250000 · @pos-migration.
// Roda na "Agência (P&M) - DEMO" (robô só em demonstração), com o mesmo caminho que a Marciana usa na Pdois:
//   a) Novo briefing: cliente buscado no cadastro, Objetivo grande, campo "Briefing" com editor e "?"; "Virar job" leva
//      o briefing completo, o prazo e o cliente para o job;
//   b/c) Pauta: filtro de cliente por busca no cadastro; responsáveis = usuários da empresa (não só "Eu");
//   d) Novo job aberto pelo link da Pauta, com cliente do cadastro e o mesmo editor de briefing.
// Limpeza: o job de teste vai para a lixeira e o briefing de teste é removido (dado de teste da demo).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbDelete, dbPatch, dbSelect, registrarJornada } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const MARCA = `Teste Bloco 1 ${Date.now()}`

test.describe('P&M Bloco 1 — briefing, clientes do cadastro, responsáveis', () => {
  test.afterAll(async () => {
    await dbPatch('agency_jobs', `company_id=eq.${DEMO_PM}&titulo=eq.${encodeURIComponent(MARCA)}`, { excluido_em: new Date().toISOString() }).catch(() => {})
    await dbDelete('agency_briefings', `company_id=eq.${DEMO_PM}&titulo=eq.${encodeURIComponent(MARCA)}`).catch(() => {})
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-bloco1-pdois', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('briefing completo com cliente do cadastro vira job inteiro', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/pm/briefings')
    await aguardarConteudo(page)
    await page.getByTestId('briefing-novo').click()
    const modal = page.getByTestId('briefing-modal')
    await modal.getByTestId('briefing-cliente-input').fill('Pet Am')
    await modal.getByTestId('briefing-cliente-opcao').filter({ hasText: 'Pet Amigo' }).first().click()
    await expect(modal.getByTestId('briefing-cliente-valor')).toHaveText('Pet Amigo', { timeout: 15000 })
    await modal.getByTestId('briefing-titulo').fill(MARCA)
    await modal.getByTestId('briefing-objetivo').fill('Levar tutores para a clínica na semana do Dia dos Animais.')
    await modal.getByTestId('briefing-texto-texto').fill('**Entregáveis:** 1 carrossel 1080×1350 + 2 stories\n- evitar foto de bicho triste')
    await modal.getByTestId('briefing-prazo').fill('2026-10-20')
    for (const k of ['pm.briefing.texto', 'pm.briefing.objetivo', 'pm.cliente.busca']) await expect(modal.getByTestId(`ajuda-${k}`)).toBeVisible()
    await expect(modal.getByTestId('briefing-texto-link')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-b1-briefing-modal.png', fullPage: false })
    await modal.getByTestId('briefing-salvar').click()
    const item = page.getByTestId('briefing-item').filter({ hasText: MARCA })
    await expect(item).toBeVisible({ timeout: 15000 })
    page.once('dialog', (d) => void d.accept())
    await item.getByTestId('briefing-virar-job').click()
    await expect(page.getByTestId('briefing-toast')).toContainText('briefing completo', { timeout: 15000 })

    const [job] = await dbSelect<{ descricao: string; data_prazo: string; cliente_id: string }>('agency_jobs', `company_id=eq.${DEMO_PM}&titulo=eq.${encodeURIComponent(MARCA)}&select=descricao,data_prazo,cliente_id`)
    expect(job.descricao).toContain('**Objetivo:** Levar tutores')
    expect(job.descricao).toContain('**Entregáveis:** 1 carrossel')
    expect(String(job.data_prazo).slice(0, 10)).toBe('2026-10-20')
    const [perfil] = await dbSelect<{ erp_cliente_id: string | null; nome: string }>('agency_clientes', `id=eq.${job.cliente_id}&select=erp_cliente_id,nome`)
    expect(perfil.erp_cliente_id, 'cliente do job é o do cadastro (erp_clientes)').toBeTruthy()
  })

  test('Pauta: cliente por busca no cadastro e responsáveis da empresa; Novo job pelo link', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/pm/pauta')
    await aguardarConteudo(page)
    await expect(page.getByTestId('pauta-novo-job')).toBeVisible({ timeout: 20000 })
    await page.getByTestId('pauta-abrir-filtro').click()
    const painel = page.getByTestId('pauta-painel')
    expect(await painel.getByTestId('pauta-f-responsavel').locator('label').count(), 'responsáveis = usuários da empresa (mais que "Eu")').toBeGreaterThan(1)
    await painel.getByTestId('pauta-f-cliente-busca-input').fill('Café Serra')
    await painel.getByTestId('pauta-f-cliente-busca-opcao').filter({ hasText: 'Café Serra Azul' }).first().click()
    await expect(painel.getByTestId('pauta-f-cliente-chip')).toContainText('Café Serra Azul')
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-b1-pauta-filtro.png', fullPage: false })
    await painel.getByTestId('pauta-filtrar').click()
    await expect(page.locator('[data-testid^="pauta-linha-"]').first()).toBeVisible({ timeout: 15000 })
    const linhas = await page.locator('[data-testid^="pauta-linha-"]').allInnerTexts()
    expect(linhas.every((l) => l.includes('Café Serra Azul')), 'só jobs do cliente escolhido').toBe(true)
    // volta a pauta limpa para os próximos testes
    await page.getByTestId('pauta-abrir-filtro').click()
    await page.getByTestId('pauta-limpar').click()
    await page.getByTestId('pauta-filtrar').click()

    await page.getByTestId('pauta-novo-job').click()
    await expect(page.getByTestId('job-cliente-input')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('job-briefing-link')).toBeVisible()
    await expect(page.getByTestId('ajuda-pm.job.briefing')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-b1-novo-job.png', fullPage: false })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-b1-novo-job-celular.png', fullPage: false })
  })
})
