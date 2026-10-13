// #47 (Tryo) · "Preciso que não apareça na listagem 'documentos' — apenas conste os itens que estão habilitados
// para o funcionário" (10/09) e "remover justificativa para tornar o processo mais rápido" (11/09).
// A aba Documentos da ficha lista só o que se aplica à pessoa; "Não se aplica" é um clique, sem pedir motivo.
// Só frontend (sem migration): roda no preview da PR. Demonstração Indústria (SST); reset da demo no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, rpc, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'

test.describe('Ficha do funcionário — documentos só os aplicáveis (#47)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-documentos-aplicaveis-47', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { await rpc('fn_demo_reset', { p_company_id: DEMO_SST }) })

  test('o dispensado some da lista e "Não se aplica" não pede justificativa', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [func] = await dbSelect<{ id: string }>('compliance_funcionarios',
      `company_id=eq.${DEMO_SST}&nome_completo=eq.${encodeURIComponent('Rafael Gomes Demo')}&select=id`)
    expect(func, 'a demo tem o Rafael, com a Audiometria dispensada').toBeTruthy()

    // A demo só traz exigências de TERCEIRO; a configuração por pessoa lista as do próprio funcionário. Cria uma
    // exigência "para todos" (RG e CPF) só para esta jornada — o reset da demo no fim a remove.
    const [rg] = await dbSelect<{ id: string }>('compliance_tipos_documento', `nome=eq.${encodeURIComponent('RG e CPF')}&select=id&limit=1`)
    await dbInsert('compliance_documento_exigido', { company_id: DEMO_SST, tipo_documento_id: rg.id, aplica_a: 'funcionario', obrigatorio: true, ativo: true })

    let pediuJustificativa = false
    page.on('dialog', async (d) => { pediuJustificativa = true; await d.dismiss() })

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto(`/dashboard/compliance/funcionarios/${func.id}`)
    await aguardarConteudo(page)
    await page.getByRole('button', { name: /^Documentos \(/ }).click()

    const linhas = page.getByTestId('doc-linha')
    await expect(linhas.first()).toBeVisible({ timeout: 20000 })
    await expect(page.locator('[data-testid="doc-linha"][data-doc="Audiometria NR-7"]'), 'o dispensado não aparece na lista').toHaveCount(0)
    const antes = await linhas.count()
    await expect(page.getByRole('button', { name: `Documentos (${antes})` }), 'a contagem da aba bate com a lista').toBeVisible()

    // Marca mais um como "não se aplica": um clique, sem justificativa, e ele sai da lista.
    await page.getByRole('button', { name: /Quais documentos esta pessoa precisa/ }).click()
    const alvo = page.getByTestId('doc-config-linha').filter({ has: page.getByTestId('doc-nao-se-aplica') }).first()
    await expect(alvo).toBeVisible({ timeout: 20000 })
    const nomeDoc = (await alvo.getAttribute('data-doc')) ?? ''
    expect(nomeDoc).not.toBe('')
    await alvo.getByTestId('doc-nao-se-aplica').click()

    await expect(page.locator(`[data-testid="doc-linha"][data-doc="${nomeDoc}"]`), 'saiu da lista').toHaveCount(0, { timeout: 20000 })
    await expect(linhas).toHaveCount(antes - 1)
    expect(pediuJustificativa, 'não pede justificativa').toBe(false)

    const [tipo] = await dbSelect<{ id: string }>('compliance_tipos_documento', `nome=eq.${encodeURIComponent(nomeDoc)}&select=id&limit=1`)
    const disp = await dbSelect<{ motivo: string | null; ativo: boolean; dispensado_em: string | null }>('compliance_dispensas',
      `funcionario_id=eq.${func.id}&tipo_documento_id=eq.${tipo.id}&select=motivo,ativo,dispensado_em`)
    expect(disp[0]?.ativo, 'a dispensa ficou gravada').toBe(true)
    expect(disp[0]?.dispensado_em, 'com quando (trilha)').toBeTruthy()
  })
})
