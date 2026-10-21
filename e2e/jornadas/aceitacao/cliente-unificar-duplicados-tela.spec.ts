// Caixa jordana-code 3352399e, item 3 (Gean · FC Pisos, Eng. Chefe 09/10): a TELA de unificar cadastros com o mesmo
// CNPJ/CPF. Em Clientes → "CNPJ/CPF repetido": o par aparece, o principal sugerido é o ativo, "Ver o que vai mudar" mostra
// o título a mover e "Unificar" passa o título para o principal e inativa o duplicado. As funções do banco (#2302) têm
// a própria aceitação; aqui é o caminho do usuário. Demonstração Comércio (GE), nunca empresa real; limpeza no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const DOC = `7${Date.now().toString().slice(-9)}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`
const DOC_FMT = `${DOC.slice(0, 2)}.${DOC.slice(2, 5)}.${DOC.slice(5, 8)}/${DOC.slice(8, 12)}-${DOC.slice(12)}`
const hoje = new Date().toISOString().slice(0, 10)

const clientes: string[] = []
const titulos: string[] = []

test.describe('Clientes: tela "CNPJ/CPF repetido" unifica o par (caixa 3352399e, item 3)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-cliente-unificar-tela', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    for (const id of titulos) await dbPatch('erp_receber', `id=eq.${id}`, { deleted_at: new Date().toISOString() })
    for (const id of clientes) await dbPatch('erp_clientes', `id=eq.${id}`, { ativo: false })
  })

  test('abre a lista, confere a prévia e unifica pelo botão', { tag: '@pos-migration' }, async ({ page }) => {
    const principal = (await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_COMERCIO, tipo_pessoa: 'PJ', ativo: true, cnpj_cpf: DOC, nome_fantasia: `Tela unificar principal ${RUN}`,
    })).id
    clientes.push(principal)
    const duplicado = (await dbInsert<{ id: string }>('erp_clientes', {
      company_id: DEMO_COMERCIO, tipo_pessoa: 'PJ', ativo: false, cpf_cnpj: DOC_FMT, nome_fantasia: `Tela unificar duplicado ${RUN}`,
    })).id
    clientes.push(duplicado)
    const titulo = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, cliente_id: duplicado, cliente_nome: `Tela unificar duplicado ${RUN}`,
      descricao: `Aceitação tela unificar ${RUN}`, valor: 150, data_emissao: hoje, data_vencimento: hoje, forma_pagamento: 'pix', status: 'aberto',
    })).id
    titulos.push(titulo)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/cadastros/clientes')
    await aguardarConteudo(page)
    await page.getByTestId('abrir-unificar-duplicados').click()

    const modal = page.getByTestId('unificar-duplicados')
    const grupo = modal.getByTestId('grupo-duplicado').filter({ hasText: `Tela unificar principal ${RUN}` })
    await expect(grupo).toBeVisible({ timeout: 20000 })
    await grupo.getByRole('button', { name: new RegExp(DOC_FMT.replace(/[./]/g, '\\$&')) }).click()

    // o sugerido como principal é o ativo
    await expect(grupo.getByRole('radio').first()).toBeChecked()
    await expect(grupo.locator('label', { has: page.getByRole('radio', { checked: true }) })).toContainText(`Tela unificar principal ${RUN}`)

    await expect(grupo.getByRole('button', { name: 'Unificar' })).toBeDisabled()
    await grupo.getByRole('button', { name: 'Ver o que vai mudar' }).click()
    await expect(grupo.getByTestId('previa-unificacao')).toContainText('1 ×', { timeout: 15000 })
    await grupo.getByRole('button', { name: 'Unificar' }).click()
    await expect(modal.getByRole('status')).toContainText('Unificado', { timeout: 15000 })

    const [t] = await dbSelect<{ cliente_id: string; valor: number; status: string }>('erp_receber', `id=eq.${titulo}&select=cliente_id,valor,status`)
    expect(t, 'o título passou para o principal sem mudar valor nem status').toEqual({ cliente_id: principal, valor: 150, status: 'aberto' })
    const [d] = await dbSelect<{ ativo: boolean; unificado_para: string | null }>('erp_clientes', `id=eq.${duplicado}&select=ativo,unificado_para`)
    expect(d).toEqual({ ativo: false, unificado_para: principal })
    await expect(modal.getByTestId('grupo-duplicado').filter({ hasText: `Tela unificar principal ${RUN}` }), 'o par some da lista').toHaveCount(0)
  })
})
