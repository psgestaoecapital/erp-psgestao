// Vínculos gerencial × contábil (CEO 29/09 · FC): tela com vínculo PROPOSTO (editável) → CONFIRMADO (imutável), ação em
// massa, filtro de pendências como padrão. Migration 20260929060000 (@pos-migration: depende das funções novas).
// Demonstração Comércio GE: três contas contábeis de teste, criadas e removidas no teste.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const COD = [1, 2, 3].map((i) => `9.V${RUN}.${i}`)
const ids: Record<string, string> = {}
let gA = { id: '', codigo: '' }
let gB = { id: '', codigo: '' }

async function comoRobo<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  expect(r.status, `${fn} responde`).toBe(200)
  return (await r.json()) as T
}

test.describe('Vínculos gerencial × contábil — proposto → confirmado', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const ger = await dbSelect<{ id: string; codigo: string }>('erp_plano_contas',
      `company_id=eq.${DEMO_GE}&ativo=eq.true&is_totalizador=eq.false&select=id,codigo&order=codigo&limit=2&offset=1`)
    expect(ger.length, 'a demo tem contas gerenciais').toBe(2)
    ;[gA, gB] = ger
    for (const cod of COD) ids[cod] = (await dbInsert<{ id: string }>('erp_conta_contabil', { company_id: DEMO_GE, codigo: cod, descricao: `E2E vínculo ${cod}`, analitica: true })).id
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-vinculos-contabil-proposto', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const id of Object.values(ids)) {
      await dbDelete('erp_conta_contabil_vinculo', `conta_contabil_id=eq.${id}`).catch(() => {})
      await dbDelete('erp_conta_contabil', `id=eq.${id}`).catch(() => {})
    }
  })

  test('propor em massa, trocar uma proposta, confirmar em massa; confirmado fica travado', { tag: '@pos-migration' }, async ({ page }) => {
    page.on('dialog', (d) => void d.accept())
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/cadastros/plano-contas/vinculos')
    await aguardarConteudo(page)
    const linha = (c: string) => page.getByTestId(`vinc-linha-${c}`)
    await expect(linha(COD[0]), 'as contas novas aparecem no filtro padrão (pendências)').toBeVisible({ timeout: 30000 })
    await page.getByTestId('vinc-busca').fill(`V${RUN}`)
    await expect(page.locator('[data-testid^="vinc-linha-"]')).toHaveCount(3)

    // propor as três para a gerencial A (em massa)
    await page.getByTestId('vinc-sel-todas').check()
    await page.getByTestId('vinc-massa-gerencial').selectOption(gA.id)
    await page.getByTestId('vinc-massa-propor').click()
    await expect(page.getByTestId('vinc-msg')).toContainText('3 nova(s)')
    for (const c of COD) await expect(page.getByTestId(`vinc-status-${c}`)).toHaveText('Proposto')

    // trocar a proposta da terceira para a gerencial B (edição de uma linha)
    await page.getByTestId(`vinc-ger-${COD[2]}`).selectOption(gB.id)
    await expect(page.getByTestId('vinc-msg')).toContainText('1 trocada(s)')

    // confirmar as duas primeiras em massa
    await linha(COD[0]).getByRole('checkbox').check()
    await linha(COD[1]).getByRole('checkbox').check()
    await page.getByTestId('vinc-massa-confirmar').click()
    await expect(page.getByTestId('vinc-msg')).toContainText('2 vínculo(s) confirmado(s)')

    // no filtro de pendências só sobra a terceira; nas confirmadas, as duas travadas
    await expect(page.locator('[data-testid^="vinc-linha-"]')).toHaveCount(1)
    await page.getByTestId('vinc-filtro-confirmado').click()
    await expect(linha(COD[0])).toHaveAttribute('data-status', 'confirmado')
    await expect(linha(COD[0]).getByRole('checkbox')).toBeDisabled()
    await expect(page.getByTestId(`vinc-ger-${COD[0]}`), 'confirmado não tem seletor de gerencial').toHaveCount(0)

    const v = await dbSelect<{ conta_contabil_id: string; status: string; plano_conta_id: string }>('erp_conta_contabil_vinculo',
      `conta_contabil_id=in.(${Object.values(ids).join(',')})&ativo=eq.true&select=conta_contabil_id,status,plano_conta_id`)
    const por = Object.fromEntries(v.map((x) => [x.conta_contabil_id, x]))
    expect(por[ids[COD[0]]]?.status).toBe('confirmado')
    expect(por[ids[COD[1]]]?.plano_conta_id, 'duas contábeis na mesma gerencial').toBe(gA.id)
    expect(por[ids[COD[2]]]).toMatchObject({ status: 'proposto', plano_conta_id: gB.id })
  })

  test('propor sobre confirmado é ignorado pelo banco (imutável)', { tag: '@pos-migration' }, async () => {
    const r = await comoRobo<{ ok: boolean; ignoradas_confirmadas: number; trocados: number }>('fn_conta_contabil_vinculo_propor',
      { p_company_id: DEMO_GE, p_conta_contabil_ids: [ids[COD[0]]], p_plano_conta_id: gB.id, p_origem: 'e2e' })
    expect(r.ok).toBe(true)
    expect(r.ignoradas_confirmadas, 'o confirmado não muda').toBe(1)
    expect(r.trocados).toBe(0)
  })
})
