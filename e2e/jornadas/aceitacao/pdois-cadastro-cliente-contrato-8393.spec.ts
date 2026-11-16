// RD-78 · Aceitação do chamado #8393 (PDOIS, Edney Prigol): "não salva os dados quando cadastro um novo cliente
// na aba contrato". Jornada: ao pedir um contrato, cadastrar um cliente NOVO pelo seletor inline da aba Contrato e
// confirmar que o cliente FICOU SALVO em erp_clientes (e vinculado na tela, botão "Trocar").
//
// Roda só na Demonstração Agência (RD-69/LGPD), como usuário real (RD-82); o service_role só confere o banco e
// inativa (soft) os clientes de teste no fim.
//
// #8393: o seletor inline agora leva um canal de ERRO próprio (onErro → caixa vermelha) e não finge sucesso quando a
// criação falha / não retorna id. Esta jornada prova o caminho feliz (o cliente novo é salvo) ponta a ponta.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada } from '../../support/api'

const DEMO_AGENCIA = 'b0700000-0000-4000-a000-000000000002'

test.describe('Aceitação #8393 — cadastrar cliente novo pela aba Contrato salva o cliente', () => {
  const nomes: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-8393-cliente-aba-contrato', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const nome of nomes) {
      await dbPatch('erp_clientes', `company_id=eq.${DEMO_AGENCIA}&nome_fantasia=eq.${encodeURIComponent(nome)}`, { ativo: false })
    }
  })

  test('cadastrar cliente novo no seletor da solicitação de contrato grava em erp_clientes e vincula na tela', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AGENCIA)
    await page.goto('/dashboard/contratos?tab=fee')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: '+ Solicitar elaboração' }).click()
    await expect(page.getByRole('dialog', { name: 'Solicitar elaboração de contrato' })).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'Com dados novos' }).click()

    const nome = `Cliente 8393 ${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
    nomes.push(nome)
    await page.getByPlaceholder('Buscar cliente da GE…').fill(nome)
    await page.getByText(/Cadastrar cliente/).click()
    await page.getByPlaceholder('Nome do cliente').fill(nome)
    await page.getByRole('button', { name: 'Criar' }).click()

    // A tela confirma o vínculo (o seletor passa a mostrar o cliente escolhido, com o botão "Trocar").
    await expect(page.getByRole('button', { name: 'Trocar' })).toBeVisible({ timeout: 15000 })

    // RD-38: o cliente FICOU salvo no cadastro da empresa (não "não salva").
    await expect.poll(async () => {
      const rows = await dbSelect<{ id: string }>('erp_clientes', `company_id=eq.${DEMO_AGENCIA}&nome_fantasia=eq.${encodeURIComponent(nome)}&ativo=eq.true&select=id`)
      return rows.length
    }, { message: 'o cliente cadastrado na aba Contrato deve existir em erp_clientes', timeout: 15000 }).toBeGreaterThan(0)
  })
})
