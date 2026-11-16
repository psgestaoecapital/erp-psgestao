// RD-78 · Aceitação do chamado #6703 (PDOIS, Edney Prigol): "ao preencher o contrato, o sistema deve trazer TODOS os
// dados do cliente cadastrado, não só o nome". Jornada: na aba "Com dados novos" da solicitação de contrato, ao
// escolher um cliente já cadastrado, os campos CPF/CNPJ e Responsável preenchem sozinhos a partir do cadastro — sem
// digitação manual (antes, escolher o cliente só gravava o nome/id e deixava o CPF/CNPJ em branco).
//
// Roda só na Demonstração Agência (RD-69/LGPD), como usuário real (RD-82); o service_role só semeia o cliente de
// teste (com CPF/CNPJ e contato) e o inativa (soft) no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_AGENCIA = 'b0700000-0000-4000-a000-000000000002'
const DOC = '11222333000181' // CNPJ válido (fixo) — prova do preenchimento automático

test.describe('Aceitação #6703 — escolher cliente na aba Contrato preenche CPF/CNPJ e responsável do cadastro', () => {
  const ids: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-6703-autofill-cliente-contrato', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const id of ids) await dbPatch('erp_clientes', `id=eq.${id}`, { ativo: false })
  })

  test('escolher cliente cadastrado traz CPF/CNPJ e responsável sem digitar à mão', async ({ page }) => {
    const nome = `Cliente 6703 ${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
    const contato = 'Edney Prigol (resp. teste)'
    const cli = await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_AGENCIA, nome_fantasia: nome, razao_social: nome,
      cnpj_cpf: DOC, email: 'contrato6703@demo.local', telefone: '(11) 4000-6703',
      cidade: 'São Paulo', uf: 'SP', contato_operacional: contato, ativo: true,
    })
    ids.push(cli.id)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AGENCIA)
    await page.goto('/dashboard/contratos?tab=fee')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: '+ Solicitar elaboração' }).click()
    await expect(page.getByRole('dialog', { name: 'Solicitar elaboração de contrato' })).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'Com dados novos' }).click()

    // busca o cliente pelo nome e escolhe a sugestão
    await page.getByPlaceholder('Buscar cliente da GE…').fill(nome)
    await page.getByText(nome, { exact: false }).last().click()
    await expect(page.getByRole('button', { name: 'Trocar' })).toBeVisible({ timeout: 15000 })

    // #6703: o CPF/CNPJ preencheu sozinho a partir do cadastro (antes ficava em branco)
    const docInput = page.getByPlaceholder('Obrigatório (só números do documento)')
    await expect.poll(async () => (await docInput.inputValue()).replace(/\D/g, ''), {
      message: 'o CPF/CNPJ deve preencher automaticamente com o documento do cadastro', timeout: 15000,
    }).toBe(DOC)

    // o responsável/contato do cadastro também veio
    await expect(page.getByPlaceholder('Quem assina / contato no cliente')).toHaveValue(contato, { timeout: 15000 })
  })

  test('cliente com cadastro incompleto mostra aviso de dados faltantes sem bloquear', async ({ page }) => {
    const nome = `Cliente 6703 bare ${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
    const cli = await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_AGENCIA, nome_fantasia: nome, razao_social: nome, cnpj_cpf: DOC, ativo: true,
      // sem endereço, e-mail e telefone — devem aparecer no aviso
    })
    ids.push(cli.id)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AGENCIA)
    await page.goto('/dashboard/contratos?tab=fee')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: '+ Solicitar elaboração' }).click()
    await expect(page.getByRole('dialog', { name: 'Solicitar elaboração de contrato' })).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'Com dados novos' }).click()
    await page.getByPlaceholder('Buscar cliente da GE…').fill(nome)
    await page.getByText(nome, { exact: false }).last().click()
    await expect(page.getByRole('button', { name: 'Trocar' })).toBeVisible({ timeout: 15000 })

    // #6703 (c): aviso não-bloqueante lista o que falta no cadastro
    await expect(page.getByText(/Faltam dados no cadastro deste cliente/)).toBeVisible({ timeout: 15000 })
  })
})
