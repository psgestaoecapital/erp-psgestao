// PDCA Hub · /dashboard/projetos/configuracoes — o autosave grava de verdade (antes: UPDATE direto numa tabela só
// com policy de leitura e nomes de coluna errados para AC/GA; nada era salvo). Construtora DEMO: muda a margem alvo,
// espera "Salvo às", confere no banco, recarrega e vê o valor; devolve o valor original no fim.
// Depende da RPC fn_projetos_config_salvar (migration 20261024020000) → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000006'
type Cfg = { margem_alvo_pct: number | string | null; bdi_admin_central_pct: number | string | null; bdi_total_pct: number | string | null }
let original: number | null = null

async function lerConfig(): Promise<Cfg> {
  const [c] = await dbSelect<Cfg>('projetos_modulo_config', `company_id=eq.${DEMO}&select=margem_alvo_pct,bdi_admin_central_pct,bdi_total_pct`)
  return c
}

test.describe('Hub — Configurações grava', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-configuracoes-salvar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (original != null) await rpc('fn_projetos_config_salvar', { p_company_id: DEMO, p_dados: { margem_alvo_pct: original } }).catch(() => {})
  })

  test('margem alvo editada é salva, persiste e mostra o BDI real de AC', { tag: '@pos-migration' }, async ({ page }) => {
    const antes = await lerConfig()
    original = Number(antes?.margem_alvo_pct ?? 15)
    const novo = original === 17 ? 18 : 17
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)

    await page.goto('/dashboard/projetos/configuracoes')
    await aguardarConteudo(page)
    const campo = page.getByTestId('campo-projetos.config.margem_alvo')
    await expect(campo).toBeVisible({ timeout: 30000 })
    await campo.fill(String(novo))
    await expect(page.getByText(/Salvo às \d{2}:\d{2}/)).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Erro ao salvar')).toHaveCount(0)

    await expect.poll(async () => Number((await lerConfig()).margem_alvo_pct), { timeout: 15000 }).toBe(novo)

    await page.reload()
    await aguardarConteudo(page)
    await expect(page.getByTestId('campo-projetos.config.margem_alvo')).toHaveValue(String(novo), { timeout: 30000 })
    // BDI total mostrado = o recalculado pelo banco (trigger), com AC lido da coluna certa
    const depois = await lerConfig()
    await expect(page.getByText(`${Number(depois.bdi_total_pct).toFixed(2)}%`).first()).toBeVisible()
  })
})
