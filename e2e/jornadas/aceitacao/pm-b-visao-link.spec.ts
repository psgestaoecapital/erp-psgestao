// PM-B · link da visão salva (CEO 02/10, visita à Pdois). Migration 20261002240000 · @pos-migration.
// Na "Agência (P&M) - DEMO", como o robô:
//   1) o link /dashboard/pm/pauta?visao=<id> de uma visão da equipe abre a Pauta já filtrada, com a faixa "Visão: …",
//      "Copiar link" e o "?" do link;
//   2) o link de uma visão "só do Gilberto" não abre para o robô: aparece o aviso para pedir o compartilhamento;
//   3) no celular a faixa da visão cabe na tela. Prints em e2e/diagnostico-host/.
// Volta a preferência do robô ao estado limpo no fim (o link grava o filtro como preferência, como na vida real).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
type Visao = { id: string; nome: string; compartilhada: boolean }

test.describe('PM-B — link da visão salva', () => {
  let token = ''
  const limparPreferencia = async () => {
    const me = JSON.parse(atob(token.split('.')[1])) as { sub: string }
    await fetch(`${SUPABASE_URL}/rest/v1/agency_pauta_preferencia?on_conflict=company_id,user_id`, { method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ company_id: DEMO_PM, user_id: me.sub, filtros: {}, agrupar: 'prazo', aba: 'todas' }) })
  }
  test.beforeAll(async () => { token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token })
  test.afterAll(async () => { await limparPreferencia().catch(() => {}) })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-b-visao-link', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('link da visão da equipe abre filtrado; visão pessoal de outro não abre', { tag: '@pos-migration' }, async ({ page }) => {
    const visoes = await dbSelect<Visao>('agency_visoes_pauta', `company_id=eq.${DEMO_PM}&excluido_em=is.null&select=id,nome,compartilhada`)
    const equipe = visoes.find((v) => v.nome === 'Atrasados da equipe')
    const pessoal = visoes.find((v) => v.nome === 'Minha pauta')
    expect(equipe?.compartilhada, 'demo tem a visão da equipe').toBe(true)
    expect(pessoal?.compartilhada, 'demo tem a visão pessoal do Gilberto').toBe(false)
    await limparPreferencia()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/dashboard/pm/pauta?visao=${equipe!.id}`)
    await aguardarConteudo(page)
    await expect(page.getByTestId('pauta-visao-atual')).toContainText('Atrasados da equipe', { timeout: 20000 })
    await expect(page.getByTestId('pauta-visao-atual')).toContainText('da equipe')
    await expect(page.getByTestId('pauta-atalho-atrasados')).toHaveClass(/border-\[#C8941A\]/)
    await expect(page.getByTestId('pauta-grupo').first()).toContainText('Atrasados', { timeout: 15000 })
    await expect(page.getByTestId('pauta-visao-copiar-link')).toBeVisible()
    await expect(page.getByTestId('ajuda-pm.pauta.visao_link')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-b-visao-link-computador.png', fullPage: false })

    // visão "só do Gilberto": o robô não a vê — aviso claro, pauta abre sem filtro
    await page.goto(`/dashboard/pm/pauta?visao=${pessoal!.id}`)
    await aguardarConteudo(page)
    await expect(page.getByTestId('pauta-erro')).toContainText('não foi compartilhada com você', { timeout: 20000 })
    await expect(page.getByTestId('pauta-visao-atual')).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/dashboard/pm/pauta?visao=${equipe!.id}`)
    await aguardarConteudo(page)
    await expect(page.getByTestId('pauta-visao-copiar-link')).toBeVisible({ timeout: 20000 })
    const caixa = await page.getByTestId('pauta-visao-atual').boundingBox()
    expect((caixa?.x ?? 0) + (caixa?.width ?? 0), 'faixa da visão cabe no celular').toBeLessThanOrEqual(390)
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-b-visao-link-celular.png', fullPage: false })
  })
})
