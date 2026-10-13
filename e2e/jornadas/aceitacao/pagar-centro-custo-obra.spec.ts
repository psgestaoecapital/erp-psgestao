// Centro de custo de verdade no contas a pagar + obra do Hub com centro de custo (CEO 01/10 · item 4, pré-requisito da
// tela de viagem: é o que liga a despesa à obra). Demonstração Comércio (GE), nunca empresa real.
//  1) obra nova (qualquer caminho de criação) nasce com o SEU centro de custo (código = número da obra);
//  2) na Nova despesa, "Centro de custo / obra" grava erp_pagar.centro_custo_id — e o texto legado espelha o nome.
// Os dois dependem da migration 20261001100000 → @pos-migration (veredito em produção logo após o deploy).
// No fim: despesa marcada como excluída, obra cancelada e centro inativo (RD-30: nada é apagado).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const NUMERO = `E2E-CC-${RUN}`
const DESC = `E2E despesa da obra ${RUN}`
let obraId = ''
let centroId = ''

test.describe('Contas a pagar: centro de custo / obra', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pagar-centro-custo-obra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    await dbPatch('erp_pagar', `company_id=eq.${DEMO}&descricao=eq.${encodeURIComponent(DESC)}`, { deleted_at: new Date().toISOString() }).catch(() => {})
    if (obraId) await dbPatch('projetos_obras', `id=eq.${obraId}`, { status: 'cancelada' }).catch(() => {})
    if (centroId) await dbPatch('erp_centros_custo', `id=eq.${centroId}`, { ativo: false }).catch(() => {})
  })

  test('obra nova nasce com o seu centro de custo (código = número da obra)', { tag: '@pos-migration' }, async () => {
    const o = await dbInsert<{ id: string; centro_custo_id: string | null }>('projetos_obras', {
      company_id: DEMO, numero: NUMERO, nome: `Obra de teste ${RUN} — Promissão/SP`, status: 'em_andamento',
    })
    obraId = o.id
    expect(o.centro_custo_id, 'a obra nasce com centro de custo').toBeTruthy()
    centroId = o.centro_custo_id!
    const [cc] = await dbSelect<{ company_id: string; codigo: string; nome: string; ativo: boolean }>('erp_centros_custo', `id=eq.${centroId}&select=company_id,codigo,nome,ativo`)
    expect(cc).toMatchObject({ company_id: DEMO, codigo: NUMERO, ativo: true })
    expect(cc.nome).toBe(`${NUMERO} · Obra de teste ${RUN} — Promissão/SP`)
  })

  test('Nova despesa com "Centro de custo / obra" grava o vínculo (id) e o nome', { tag: '@pos-migration' }, async ({ page }) => {
    test.skip(!centroId, 'depende da obra do teste anterior')
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/financeiro/nova-despesa')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: 'Nova despesa' })).toBeVisible({ timeout: 20000 })

    const sel = page.getByTestId('despesa-centro-custo')
    await expect(sel.locator(`option[value="${centroId}"]`), 'a obra aparece na lista de centros de custo').toHaveCount(1, { timeout: 20000 })
    await page.getByTestId('despesa-valor').fill('123.45')
    await page.getByPlaceholder('ex: "Aluguel sala maio" · vazio = geramos automático').fill(DESC)
    await sel.selectOption(centroId)
    await page.getByRole('button', { name: 'Salvar despesa' }).click()

    await expect.poll(async () => (await dbSelect<{ centro_custo_id: string | null }>('erp_pagar',
      `company_id=eq.${DEMO}&descricao=eq.${encodeURIComponent(DESC)}&select=centro_custo_id`))[0]?.centro_custo_id ?? null,
    { timeout: 30000, message: 'a despesa grava o centro de custo da obra' }).toBe(centroId)
    const [d] = await dbSelect<{ centro_custo: string | null; valor: number }>('erp_pagar',
      `company_id=eq.${DEMO}&descricao=eq.${encodeURIComponent(DESC)}&select=centro_custo,valor`)
    expect(d.centro_custo, 'o texto legado espelha o nome do centro').toBe(`${NUMERO} · Obra de teste ${RUN} — Promissão/SP`)
    expect(Number(d.valor)).toBe(123.45)
  })
})
