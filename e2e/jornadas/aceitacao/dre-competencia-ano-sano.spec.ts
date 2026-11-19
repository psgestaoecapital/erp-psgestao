// PDCA GE · /dashboard/financeiro/dre-consolidado · Code: code-desenvolvedor-3
// GUARDA DE COMPETÊNCIA: um typo no ANO da competência ("0002", "20026") estacionava o
// título num ano fantasma e sumia do DRE do mês certo (caso real Gean: R$903,84 de
// ago/2026 presos no "ano 2"). A tela de Nova receita agora BARRA na entrada, com
// mensagem em linguagem do usuário, e nenhum título é criado. Jornada sem migration
// (o guarda é no front) → roda no preview da PR. Demonstração Comércio (GE), nunca real.
// Não grava nada: o caso de sucesso é justamente o título NÃO existir.

import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const DESCRICAO = `Competencia ano fantasma ${RUN}`

// input/textarea logo depois do rótulo do Campo
const campo = (page: Page, rotulo: string) =>
  page.locator(`xpath=//label[starts-with(normalize-space(.), "${rotulo}")]/following-sibling::*[self::input or self::textarea or self::select][1]`).first()

test.describe('DRE · guarda de competência com ano fora da faixa sã', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('dre-competencia-ano-sano', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('competência com ano absurdo (0002) é barrada e nenhum título é criado', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/financeiro/nova-receita')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: 'Nova receita' })).toBeVisible({ timeout: 20000 })

    // descrição única (para provar que NADA foi gravado), valor, recebimento sãos
    await campo(page, 'O que é essa receita?').fill(DESCRICAO)
    await campo(page, 'Quanto vou receber?').fill('123.45')
    await campo(page, 'Quando entra na conta?').fill('2026-08-11')
    // ANO FANTASMA: typo de digitação no ano da competência
    await campo(page, 'Data de competência').fill('0002-08-11')

    await page.getByRole('button', { name: 'Salvar receita' }).click()

    // 1) banner de erro amigável, no padrão RD-41 (role=alert)
    await expect(page.getByRole('alert')).toContainText(/ano fora do comum/i, { timeout: 10000 })
    // 2) continuou na própria tela (não redirecionou para a lista)
    await expect(page).toHaveURL(/\/dashboard\/financeiro\/nova-receita/)
    // 3) nenhum título foi criado na empresa
    const linhas = await dbSelect<{ id: string }>('erp_receber',
      `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESCRICAO)}&select=id`)
    expect(linhas.length, 'o guarda barrou antes da RPC: nenhuma receita gravada').toBe(0)

    // Corrigindo o ano para a faixa sã, o guarda LIBERA (banner some ao digitar).
    await campo(page, 'Data de competência').fill('2026-08-11')
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
