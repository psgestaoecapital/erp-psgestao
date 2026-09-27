// #137 (André · PS Gestão) · "Baixei uma conta sem conciliar, quis editar para incluir a conta de débito, porém disse
// que está conciliado." A edição travava valor, vencimento E conta de TODO título pago — mas a conta só depende da
// baixa quando há EXTRATO por trás (conciliado / movimento do banco). Baixa manual sem conciliação: a conta pode ser
// informada; valor e vencimento seguem travados. Só front (roda no preview). Demonstração Comércio (GE).
// 1º teste (correção): pago SEM conciliar → escolhe a conta e salva. 2º (caminho principal): conciliado → conta travada.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const hoje = new Date().toISOString().slice(0, 10)
const CONTA = 'DEMO-GE Caixa'
const ids: string[] = []

async function pagoSemConta(conciliado: boolean): Promise<string> {
  const r = await dbInsert<{ id: string }>('erp_pagar', {
    company_id: DEMO_GE, descricao: `Aceitação #137 ${conciliado ? 'conciliado' : 'sem conciliar'} ${RUN}`,
    fornecedor_nome: 'Fornecedor Aceitação 137', valor: 137.37, valor_pago: 137.37,
    data_emissao: hoje, data_vencimento: hoje, data_pagamento: hoje, status: 'pago', forma_pagamento: 'pix',
    conciliado,
  })
  ids.push(r.id)
  return r.id
}

test.describe('Editar despesa paga — conta de débito (#137)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-137-conta-baixa-sem-conciliar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of ids) await dbPatch('erp_pagar', `id=eq.${id}`, { deleted_at: new Date().toISOString() }).catch(() => {})
  })

  async function abrir(page: import('@playwright/test').Page, id: string) {
    await page.addInitScript((c) => { try { window.localStorage.setItem('ps_empresa_sel', c) } catch { /* noop */ } }, DEMO_GE)
    await page.goto(`/dashboard/financeiro/nova-despesa?editar=${id}`)
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: 'Editar despesa' })).toBeVisible({ timeout: 20000 })
  }

  test('paga SEM conciliar: dá para informar a conta e salvar (valor segue travado)', async ({ page }) => {
    const id = await pagoSemConta(false)
    await abrir(page, id)
    const conta = page.getByTestId('despesa-conta')
    await expect(conta, 'conta liberada: não há extrato por trás').toBeEnabled()
    await conta.selectOption(CONTA)
    await page.getByTestId('salvar-edicao').click()
    await expect.poll(async () => (await dbSelect<{ conta_bancaria: string | null; valor: number; status: string }>('erp_pagar',
      `id=eq.${id}&select=conta_bancaria,valor,status`))[0], { timeout: 15000 })
      .toMatchObject({ conta_bancaria: CONTA, status: 'pago' })
    const [d] = await dbSelect<{ valor: number }>('erp_pagar', `id=eq.${id}&select=valor`)
    expect(Number(d.valor), 'valor intacto').toBe(137.37)
  })

  test('conciliada com o extrato: a conta continua travada', async ({ page }) => {
    const id = await pagoSemConta(true)
    await abrir(page, id)
    await expect(page.getByTestId('despesa-conta')).toBeDisabled()
    await expect(page.getByTestId('edicao-situacao')).toContainText('conciliado')
  })
})
