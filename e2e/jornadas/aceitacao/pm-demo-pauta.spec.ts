// PM-A · demonstração da Pauta (visita à Pdois, CEO 02/10). Migration 20261002200000 · @pos-migration.
// Na "Agência (P&M) - DEMO", como o robô:
//   1) o cenário existe e é útil: atrasados, vence hoje, esperando cliente, "Meus" e todas as abas com job;
//   2) a lista por prazo começa pelos atrasados e o código mostra a letra da rodada (24101A);
//   3) na tela (computador e celular): abas com contador, grupo "Atrasados" no topo, atalhos e "?" no filtro.
//   Prints em e2e/diagnostico-host/ (sobem como artefato do run).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

type Cont = { total: number; atrasados: number; por_situacao: Record<string, number> }
type Lista = { total: number; itens: { codigo: string; rodada: number; atrasado: boolean; cliente: string | null; responsavel: string | null }[] }

test.describe('PM-A — Pauta da demonstração pronta para mostrar', () => {
  let token = ''
  const rpc = async <T,>(fn: string, args: Record<string, unknown>) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
    return (await r.json()) as T
  }
  test.beforeAll(async () => { token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-demo-pauta', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('cenário: atrasados, hoje, esperando cliente, Meus e todas as abas', { tag: '@pos-migration' }, async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_PM}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const seed = await dbSelect<{ id: string }>('agency_jobs', `company_id=eq.${DEMO_PM}&tags=cs.{demo-pauta}&excluido_em=is.null&select=id`)
    expect(seed.length, 'cenário de 48 jobs').toBeGreaterThanOrEqual(40)
    const c = await rpc<Cont>('fn_pauta_contadores', { p_company_id: DEMO_PM, p_filtros: {} })
    for (const st of ['nao_iniciada', 'em_producao', 'aguardando', 'em_aprovacao', 'concluida', 'publicado'])
      expect(c.por_situacao[st] ?? 0, `aba ${st} com job`).toBeGreaterThan(0)
    expect(c.atrasados, 'atrasados').toBeGreaterThanOrEqual(5)
    const atalho = async (a: string) => (await rpc<Cont>('fn_pauta_contadores', { p_company_id: DEMO_PM, p_filtros: { atalho: a } })).total
    expect(await atalho('hoje'), 'vence hoje').toBeGreaterThanOrEqual(3)
    expect(await atalho('esperando_cliente'), 'esperando o cliente').toBeGreaterThanOrEqual(3)
    expect(await atalho('meus'), '"Meus" do robô').toBeGreaterThanOrEqual(3)

    const l = await rpc<Lista>('fn_pauta_listar', { p_company_id: DEMO_PM, p_filtros: {}, p_agrupar: 'prazo', p_por_pagina: 50 })
    expect(l.itens[0]?.atrasado, 'a lista começa pelos atrasados').toBe(true)
    expect(l.itens.some((i) => i.rodada > 0 && /^\d+[A-Z]$/.test(i.codigo)), 'código com a letra da rodada (24101A)').toBe(true)
    expect(l.itens.every((i) => !!i.cliente), 'todo job da página tem cliente').toBe(true)
  })

  test('tela: abas com contador, "Atrasados" no topo, atalhos e "?" — prints', { tag: '@pos-migration' }, async ({ page }) => {
    // começa limpo: sem filtro salvo, agrupado por prazo, aba "Todas"
    const me = JSON.parse(atob(token.split('.')[1])) as { sub: string }
    await fetch(`${SUPABASE_URL}/rest/v1/agency_pauta_preferencia?on_conflict=company_id,user_id`, { method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ company_id: DEMO_PM, user_id: me.sub, filtros: {}, agrupar: 'prazo', aba: 'todas' }) })

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/pm/pauta')
    await aguardarConteudo(page)
    await expect(page.getByTestId('pauta-page')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('pauta-grupo').first()).toContainText('Atrasados', { timeout: 20000 })
    const nAtr = Number(await page.getByTestId('pauta-aba-n-em_producao').innerText())
    expect(nAtr, 'aba "Em produção" com contador').toBeGreaterThan(0)
    for (const a of ['meus', 'atrasados', 'hoje', 'esperando_cliente']) await expect(page.getByTestId(`pauta-atalho-${a}`)).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-a-pauta-computador.png', fullPage: false })

    await page.getByTestId('pauta-atalho-atrasados').click()
    await expect(page.getByTestId('pauta-grupo').first()).toContainText('Atrasados', { timeout: 15000 })
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-a-pauta-atrasados.png', fullPage: false })
    await page.getByTestId('pauta-atalho-atrasados').click()

    await page.getByTestId('pauta-abrir-filtro').click()
    await expect(page.getByTestId('ajuda-pm.pauta.filtro.cliente')).toBeVisible()
    await expect(page.getByTestId('ajuda-pm.pauta.filtro.responsavel')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-a-pauta-filtro.png', fullPage: false })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard/pm/pauta')
    await aguardarConteudo(page)
    await expect(page.getByTestId('pauta-grupo').first()).toContainText('Atrasados', { timeout: 20000 })
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-a-pauta-celular.png', fullPage: false })
  })
})
