// RD-83 · CAMINHO PRINCIPAL da tela Compliance → SST · LTCAT (passo 2, #77/#53): abrir a tela, escolher o setor,
// "Nova função", preencher descrição, um risco, um EPI e um treinamento, salvar — e conferir tudo no banco.
// @pos-migration: depende da migration 20260927100000 e da Demonstração Indústria (SST). Reset da demo no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'

test.describe('Caminho principal — SST · LTCAT: cadastrar uma função completa', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-compliance-sst-ltcat', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { await rpc('fn_demo_reset', { p_company_id: DEMO_SST }) })

  test('setor Desossa → nova função com risco, EPI e treinamento → gravado no banco @pos-migration', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto('/dashboard/compliance/sst')
    await aguardarConteudo(page)

    const passo2 = page.getByTestId('ltcat-passo2')
    await expect(passo2).toBeVisible({ timeout: 20000 })
    await passo2.getByTestId('ltcat-setor').filter({ hasText: 'Desossa' }).click()
    await passo2.getByRole('button', { name: /Nova função em Desossa/ }).click()

    const ed = page.getByTestId('ltcat-editor')
    await ed.getByLabel('Nome da função').fill('Desossador de dianteiro')
    await ed.getByLabel('Descrição das atividades').fill('Desossa manual na mesa 3, faca e gancho')
    await ed.getByRole('button', { name: 'Adicionar risco' }).click()
    await ed.getByLabel('Tipo do risco 1').selectOption('ergonomico')
    await ed.getByLabel('Descrição do risco 1').fill('Movimento repetitivo')
    await ed.getByLabel(/Luva de malha de aço/).check()
    await ed.getByLabel(/NR-36 · Segurança em frigoríficos/).check()
    await ed.getByTestId('ltcat-salvar').click()

    await expect(passo2.getByTestId('ltcat-funcao').filter({ hasText: 'Desossador de dianteiro' }), 'a função aparece no setor').toBeVisible({ timeout: 20000 })

    const [setor] = await dbSelect<{ id: string }>('prod_setor', `company_id=eq.${DEMO_SST}&nome=eq.Desossa&select=id`)
    const postos = await dbSelect<{ id: string; numero: string; descricao_funcao: string }>('prod_posto',
      `setor_id=eq.${setor.id}&atividade=eq.${encodeURIComponent('Desossador de dianteiro')}&ativo=eq.true&select=id,numero,descricao_funcao`)
    expect(postos).toHaveLength(1)
    expect(postos[0].descricao_funcao).toBe('Desossa manual na mesa 3, faca e gancho')
    const riscos = await dbSelect<{ tipo: string; descricao: string }>('prod_posto_risco', `posto_id=eq.${postos[0].id}&select=tipo,descricao`)
    expect(riscos).toEqual([{ tipo: 'ergonomico', descricao: 'Movimento repetitivo' }])
    expect(await dbSelect('prod_posto_epi', `posto_id=eq.${postos[0].id}&select=id`)).toHaveLength(1)
    expect(await dbSelect('prod_posto_treinamento', `posto_id=eq.${postos[0].id}&select=id`)).toHaveLength(1)
  })
})
