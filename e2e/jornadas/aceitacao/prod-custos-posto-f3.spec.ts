// Custos do posto (CEO 11/11, custeio por kg · fatia F3 tela) — informa os custos mensais de um posto pela tela, confere
// que gravou (nova vigência) e exclui o lançamento. Prova como usuário, pela tela (RD-82); o banco só confere. Demonstração
// Indústria (…05, RD-69 — nunca na Frioeste); tudo que o teste cria é removido no fim.
// @pos-migration: depende de fn_prod_posto_custo_listar/_excluir (migration desta PR) — no preview roda informativo.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_IND = 'b0700000-0000-4000-a000-000000000005'
const TAG = `E2E CP ${Date.now()}`

type Posto = { id: string; numero: string }
type Custo = { id: string; mao_obra_mes: number | null; encargos_pct: number | null; energia_mes: number | null; horas_operacao_mes: number | null; deleted_at: string | null; vigencia_fim: string | null }

test.describe('Custos do posto — fatia F3 @pos-migration', () => {
  let plantId = ''
  let setorId = ''
  let posto: Posto | null = null
  const numero = `${Date.now()}`.slice(-5)

  test.beforeAll(async () => {
    const pl = await dbSelect<{ id: string }>('industrial_plants', `company_id=eq.${DEMO_IND}&is_active=eq.true&select=id&limit=1`).catch(() => [])
    plantId = pl[0]?.id ?? ''
    if (!plantId) return
    const st = await dbSelect<{ id: string }>('prod_setor', `company_id=eq.${DEMO_IND}&plant_id=eq.${plantId}&select=id&limit=1`).catch(() => [])
    setorId = st[0]?.id ?? ''
    if (!setorId) return
    const p = await dbInsert<{ id: string; numero: string }[] | { id: string; numero: string }>('prod_posto', {
      company_id: DEMO_IND, plant_id: plantId, setor_id: setorId, numero, atividade: `${TAG} posto`, ativo: true,
    }).catch(() => null)
    const row = Array.isArray(p) ? p?.[0] : p
    posto = row ? { id: row.id, numero: row.numero } : null
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-prod-custos-posto-f3', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (posto) {
      await dbDelete('prod_posto_custo', `posto_id=eq.${posto.id}`).catch(() => {})
      await dbDelete('prod_posto', `id=eq.${posto.id}`).catch(() => {})
    }
  })

  test('informar custos do posto → salvar (nova vigência) → excluir', { tag: '@pos-migration' }, async ({ page }) => {
    test.skip(!plantId || !setorId || !posto, 'a demonstração Indústria não tem planta/setor para o teste')
    page.on('dialog', (d) => { void d.accept() })
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
    await page.goto('/dashboard/produtividade/custos-posto')
    await aguardarConteudo(page)

    // escolher o posto do teste na lista
    await page.getByRole('button', { name: new RegExp(`${numero}`) }).first().click()
    await expect(page.getByTestId('cp-salvar')).toBeVisible()

    // preencher os custos mensais e as horas de operação
    const mes = new Date()
    const vig = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}-01`
    await page.getByTestId('cp-vigencia').fill(vig)
    await page.getByTestId('cp-mao-obra').fill('5000')
    await page.getByTestId('cp-energia').fill('1200')
    await page.getByTestId('cp-gas').fill('350')
    await page.getByTestId('cp-manutencao').fill('600')
    await page.getByTestId('cp-depreciacao').fill('800')
    await page.getByTestId('cp-horas').fill('352')
    await page.getByTestId('cp-salvar').click()
    await expect(page.getByText('Custos salvos.')).toBeVisible()

    // conferir no banco (só campos estáveis — gás/manut/deprec dependem da PR F3-backend)
    let custos: Custo[] = []
    for (let i = 0; i < 20; i++) {
      custos = await dbSelect<Custo>('prod_posto_custo', `posto_id=eq.${posto!.id}&deleted_at=is.null&select=id,mao_obra_mes,encargos_pct,energia_mes,horas_operacao_mes,deleted_at,vigencia_fim&order=created_at.desc`).catch(() => [])
      if (custos.length > 0) break
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(custos.length, 'um lançamento de custo vigente').toBe(1)
    expect(Number(custos[0].mao_obra_mes)).toBe(5000)
    expect(Number(custos[0].energia_mes)).toBe(1200)
    expect(Number(custos[0].horas_operacao_mes)).toBe(352)

    // o histórico mostra a vigência e o custo por hora é calculado na tela
    await expect(page.getByText('Histórico de custos deste posto')).toBeVisible()
    await expect(page.getByText(/\/h/)).toBeVisible()

    // excluir o lançamento (RD-98 p4)
    await page.getByTestId(`cp-excluir-${custos[0].id}`).click()
    await expect(page.getByText('Lançamento excluído.')).toBeVisible()
    let depois: Custo[] = []
    for (let i = 0; i < 20; i++) {
      depois = await dbSelect<Custo>('prod_posto_custo', `id=eq.${custos[0].id}&select=id,deleted_at,mao_obra_mes,encargos_pct,energia_mes,horas_operacao_mes,vigencia_fim`).catch(() => [])
      if (depois[0]?.deleted_at) break
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(depois[0]?.deleted_at, 'lançamento excluído (lógico)').toBeTruthy()
  })
})
