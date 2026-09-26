// RD-78 · Aceitação do chamado #59 (PDOIS): "no modelo do pedido do contrato eu preciso que seja atribuído outras
// opções como por exemplo forma de pagamento… ficou muito resumido". O pedido de contrato passa a levar CPF/CNPJ,
// responsável, objeto, serviços, forma e condição de pagamento, nº de parcelas, periodicidade, dia/1º vencimento,
// vigência, reajuste e condições específicas (lista do próprio cliente no chamado). Migration 20260926310000.
// Os testes @pos-migration só passam com a migration aplicada — o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
//
// Roda na Demonstração Agência (P&M), nunca em empresa real (a demo não tem usuário 'financeiro' → nenhum e-mail sai).
// A RPC é chamada COMO O ROBÔ (token de usuário, RD-82); o service_role só confere o banco e exclui (soft) os contratos.

import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_AGENCIA = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

type Contrato = {
  status: string; nome: string; objeto: string | null; escopo: string | null; responsavel: string | null
  forma_pagamento: string | null; condicao_pagamento: string | null; numero_parcelas: number | null; periodicidade: string | null
  dia_vencimento: number | null; data_inicio: string; data_fim: string | null; data_primeiro_vencimento: string | null
  tipo_reajuste: string | null; reajuste_percentual: number | null; condicoes_especificas: string | null; valor_mensal: number
}
const COLS = 'status,nome,objeto,escopo,responsavel,forma_pagamento,condicao_pagamento,numero_parcelas,periodicidade,dia_vencimento,data_inicio,data_fim,data_primeiro_vencimento,tipo_reajuste,reajuste_percentual,condicoes_especificas,valor_mensal'

const campo = (page: Page, rotulo: string) =>
  page.locator(`xpath=//label[starts-with(normalize-space(.), "${rotulo}")]/following-sibling::*[self::input or self::select or self::textarea][1]`).first()

async function abrirSolicitacao(page: Page) {
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AGENCIA)
  await page.goto('/dashboard/contratos?tab=fee')
  await aguardarConteudo(page)
  await page.getByRole('button', { name: '+ Solicitar elaboração' }).click()
  await expect(page.getByRole('dialog', { name: 'Solicitar elaboração de contrato' })).toBeVisible({ timeout: 20000 })
}

test.describe('Aceitação #59 — pedido de contrato com pagamento, vigência e condições', () => {
  let token = ''
  const criados: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-59-solicitar-contrato', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AGENCIA}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  })

  test.afterAll(async () => {
    for (const id of criados) await dbPatch('erp_contratos', `id=eq.${id}`, { status: 'excluido', excluido_em: new Date().toISOString(), motivo_exclusao: 'aceitação #59 (teste)' })
  })

  async function solicitarComoRobo(dados: Record<string, unknown>) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_contrato_solicitar`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: DEMO_AGENCIA, p_proposta_id: null, p_dados: dados, p_prazo_desejado: null, p_observacoes: null }),
    })
    expect(resp.ok, `fn_contrato_solicitar pela API: ${resp.status} ${await resp.clone().text()}`).toBe(true)
    return (await resp.json()) as { ok: boolean; erro?: string; contrato_id?: string }
  }

  test('a tela de solicitação traz as seções de pagamento, vigência e condições', async ({ page }) => {
    await abrirSolicitacao(page)
    for (const r of ['CPF/CNPJ do cliente', 'Responsável pelo contrato', 'Objeto do contrato', 'Serviços / produtos',
      'Forma de pagamento', 'Condição de pagamento', 'Nº de parcelas', 'Periodicidade', 'Dia do vencimento', '1º vencimento',
      'Início previsto', 'Fim da vigência', 'Reajuste', 'Condições específicas', 'Prazo desejado para o contrato']) {
      await expect(campo(page, r), `campo do pedido: ${r}`).toBeVisible()
    }
    await expect(campo(page, 'Forma de pagamento').locator('option', { hasText: 'Pix' })).toHaveCount(1)
  })

  test('a RPC grava forma/condição/parcelas/vigência/reajuste/condições (como usuário) @pos-migration', async () => {
    const r = await solicitarComoRobo({
      titulo: `Aceitação #59 ${RUN}`, valor_mensal: 1500.5, objeto: 'Assessoria de marketing', escopo: '• Gestão de redes',
      responsavel: 'Contato do cliente', forma_pagamento: 'pix', condicao_pagamento: 'entrada + 5x', numero_parcelas: 6,
      periodicidade: 'mensal', dia_vencimento: 5, data_inicio: '2026-10-01', data_fim: '2027-03-31', data_primeiro_vencimento: '2026-10-05',
      tipo_reajuste: 'ipca', reajuste_percentual: 4.5, condicoes_especificas: 'multa de 2% por atraso',
    })
    expect(r, 'solicitação criada').toMatchObject({ ok: true })
    criados.push(r.contrato_id!)
    const [c] = await dbSelect<Contrato>('erp_contratos', `id=eq.${r.contrato_id}&select=${COLS}`)
    expect(c).toMatchObject({
      status: 'solicitado', objeto: 'Assessoria de marketing', escopo: '• Gestão de redes', responsavel: 'Contato do cliente',
      forma_pagamento: 'pix', condicao_pagamento: 'entrada + 5x', numero_parcelas: 6, periodicidade: 'mensal', dia_vencimento: 5,
      data_inicio: '2026-10-01', data_fim: '2027-03-31', data_primeiro_vencimento: '2026-10-05', tipo_reajuste: 'ipca',
      condicoes_especificas: 'multa de 2% por atraso',
    })
    expect(Number(c.valor_mensal)).toBe(1500.5)
    expect(Number(c.reajuste_percentual)).toBe(4.5)

    // travas: dia fora de 1–28 e vigência invertida não criam nada
    expect(await solicitarComoRobo({ titulo: `x ${RUN}`, dia_vencimento: 31 })).toMatchObject({ ok: false, erro: 'dia_vencimento_invalido' })
    expect(await solicitarComoRobo({ titulo: `x ${RUN}`, data_inicio: '2026-10-01', data_fim: '2026-09-01' })).toMatchObject({ ok: false, erro: 'vigencia_invalida' })
  })

  test('solicitar pela tela grava a forma e a condição de pagamento e abre os anexos de referência @pos-migration', async ({ page }) => {
    const titulo = `Aceitação #59 tela ${RUN}`
    await abrirSolicitacao(page)
    await page.getByRole('button', { name: 'Com dados novos' }).click()
    await campo(page, 'Título do contrato').fill(titulo)
    await campo(page, 'Forma de pagamento').selectOption('pix')
    await campo(page, 'Condição de pagamento').fill('30/60/90')
    await campo(page, 'Nº de parcelas').fill('3')
    await campo(page, 'Dia do vencimento').fill('10')
    await campo(page, 'Condições específicas').fill('sem fidelidade')
    await page.getByTestId('solicitar-contrato').click()
    await expect(page.getByTestId('solicitacao-criada')).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Modelos e documentos de referência')).toBeVisible()

    const [c] = await dbSelect<Contrato & { id: string }>('erp_contratos', `company_id=eq.${DEMO_AGENCIA}&nome=eq.${encodeURIComponent(titulo)}&select=id,${COLS}`)
    expect(c, 'contrato criado pela tela').toBeTruthy()
    criados.push(c.id)
    expect(c).toMatchObject({ status: 'solicitado', forma_pagamento: 'pix', condicao_pagamento: '30/60/90', numero_parcelas: 3, dia_vencimento: 10, condicoes_especificas: 'sem fidelidade' })
  })
})
