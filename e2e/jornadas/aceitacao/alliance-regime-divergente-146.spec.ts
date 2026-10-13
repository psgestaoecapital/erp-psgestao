// #146 (Alliance) · "Empresa cadastrada no lucro presumido, mas continua bloqueado para informar IBS e CBS."
// Causa: o regime é editado em DOIS lugares. Configurações → Fiscal (usada na emissão) estava em Regime Normal, mas
// Configurações → Empresa (fonte da tela de Serviços) seguia "simples_nacional" → IBS/CBS travados sem explicação.
// Agora a aba Reforma Tributária avisa a divergência e leva ao lugar de corrigir. Só front — roda no preview.
// Demonstração Comércio (GE, simples_nacional): cria uma config fiscal "regime_normal" de teste e apaga no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Serviço — regime divergente entre Empresa e Fiscal (#146)', () => {
  let cfgId = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-regime-divergente-146', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (cfgId) await dbDelete('erp_fiscal_provider_config', `id=eq.${cfgId}`).catch(() => {})
  })

  async function abrirAbaRT(page: import('@playwright/test').Page) {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/cadastros/servicos')
    await aguardarConteudo(page)
    await page.getByTestId('servico-novo').click()
    await page.getByRole('button', { name: 'Reforma Tributária' }).click()
  }

  test('sem divergência (empresa e fiscal no Simples) → só o aviso de Simples', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean; regime_tributario: string | null }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo,regime_tributario`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    expect(emp.regime_tributario).toBe('simples_nacional')
    expect((await dbSelect('erp_fiscal_provider_config', `company_id=eq.${DEMO_COMERCIO}&select=id`)).length, 'demo sem config fiscal').toBe(0)
    await abrirAbaRT(page)
    await expect(page.getByText('Desabilitado para Simples Nacional')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('rt-regime-divergente')).toHaveCount(0)
  })

  test('empresa no Simples × fiscal em Regime Normal → avisa e aponta onde corrigir', async ({ page }) => {
    const cfg = await dbInsert<{ id: string }>('erp_fiscal_provider_config', { company_id: DEMO_COMERCIO, provider: 'focusnfe', ambiente: 'homologacao', ativo: true, regime_tributario: 'regime_normal' })
    cfgId = cfg.id
    await abrirAbaRT(page)
    const aviso = page.getByTestId('rt-regime-divergente')
    await expect(aviso).toBeVisible({ timeout: 20000 })
    await expect(aviso).toContainText('Regime Normal')
    await expect(aviso.getByRole('link', { name: /Corrigir em Configurações/ })).toHaveAttribute('href', '/dashboard/configuracoes/empresa')
  })
})
