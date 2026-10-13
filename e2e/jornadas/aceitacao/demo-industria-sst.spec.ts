// RD-69 · Demonstração "Indústria (SST) - DEMO" (decisão do CEO 26/09): empresa de demonstração da área compliance,
// criada pelo caminho oficial com reset. Destrava #77/#53 (LTCAT) e #75 (Matriz de Conformidade) sem tocar a Frioeste.
// Migration 20260926340000 · @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
// O reset é da própria demo (idempotente); nenhuma empresa real é lida para escrita.

import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'

type Seed = {
  ok: boolean; funcionarios: number; terceirizados: number; documentos: number; vencidos: number; vencendo: number
  epi_fichas: number; ponto_dias: number; prod_setor: number; alertas_caixa_outros: number
}
type Reset = { ok: boolean; seed: string; resultado: Seed }

async function abrir(page: Page, rota: string) {
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
  await page.goto(rota)
  await aguardarConteudo(page)
}

test.describe('Demonstração Indústria (SST)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-demo-industria-sst', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('demo existe, com plano compliance a R$ 0, e o reset repõe o mesmo estado @pos-migration', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'a empresa é de demonstração').toBe(true)
    const subs = await dbSelect<{ monthly_price_brl: number }>('tenant_subscriptions',
      `company_id=eq.${DEMO_SST}&plan_id=eq.v15_compliance&status=eq.active&select=monthly_price_brl`)
    expect(subs, 'plano compliance ativo').toHaveLength(1)
    expect(Number(subs[0].monthly_price_brl), 'demonstração não entra no MRR').toBe(0)
    const [area] = await dbSelect<{ company_id: string }>('demo_por_area', 'area=eq.compliance&select=company_id')
    expect(area?.company_id, 'o robô fotografa a área compliance na demo').toBe(DEMO_SST)

    const r1 = await rpc<Reset>('fn_demo_reset', { p_company_id: DEMO_SST })
    const r2 = await rpc<Reset>('fn_demo_reset', { p_company_id: DEMO_SST })
    expect(r1.ok && r2.ok).toBe(true)
    expect(r1.seed).toBe('fn_gold_sst_seed_reparar')
    expect(r2.resultado, 'reset idempotente: a segunda passada repõe exatamente o mesmo estado').toEqual(r1.resultado)
    expect(r1.resultado).toMatchObject({ funcionarios: 27, terceirizados: 3, epi_fichas: 24, ponto_dias: 120, prod_setor: 2 })
    expect(r1.resultado.vencidos, 'a matriz tem documento vencido').toBeGreaterThan(0)
    expect(r1.resultado.vencendo, 'a matriz tem documento vencendo').toBeGreaterThan(0)
    expect(r1.resultado.alertas_caixa_outros, 'alerta de vencimento da demo nunca cai na caixa de uma pessoa real').toBe(0)
  })

  test('Matriz de Conformidade e SST (LTCAT) abrem com os dados da demo @pos-migration', async ({ page }) => {
    await abrir(page, '/dashboard/compliance/matriz')
    await expect(page.getByText('Ana Paula Demo').first(), 'funcionário da demo na matriz').toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Zeca Terceiro Demo').first(), 'terceirizado da demo na matriz').toBeVisible()

    await abrir(page, '/dashboard/compliance/sst')
    await expect(page.getByText('Câmara Fria').first(), 'setor do ponto aparece no LTCAT').toBeVisible({ timeout: 20000 })
  })
})
