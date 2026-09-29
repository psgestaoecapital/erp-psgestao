// #88 (FC Pisos, CEO 29/09) · o Sicredi da FC recusa o Código de Acesso desde 24/09 e a tela de Conexões mostrava o
// erro cru ("401 invalid_grant"). Agora o teste que falha mostra o que fazer (catálogo erp_banco_erro_catalogo) e o
// botão "Sincronizar extrato" some para banco sem conector de extrato (Sicredi é fase 2) — no lugar, o caminho do OFX.
// A demonstração bloqueia gravar config bancária, então a conexão Sicredi e a resposta do banco vêm SIMULADAS no
// navegador (page.route); o catálogo é lido de verdade. Nada é gravado. Só frontend: roda no preview.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const ERRO_FC = 'Sicredi auth falhou: 401 {"error":"invalid_grant","error_description":"Invalid user credentials"}'

const cfgSicredi = {
  id: '00000000-0000-4000-a000-000000000088', company_id: DEMO_COMERCIO, provider: 'sicredi', ambiente: 'producao',
  client_id: null, cooperativa: '0313', conta: '59476', codigo_beneficiario: '00055', posto: '16', convenio: null,
  agencia: null, agencia_dv: null, carteira: '331', cap_boleto: true, cap_extrato: true, cap_pagamento: false, ativo: true,
  ultimo_sync_em: null, ultimo_sync_status: null, banco_conta_id: null, estado_conexao: 'producao', cert_expira_em: null,
  juros_pct: null, multa_pct: null, dias_multa: null, dias_juros: null,
  instrucao_linha1: null, instrucao_linha2: null, instrucao_linha3: null, instrucao_linha4: null,
  client_secret_vault_id: null, cert_vault_id: null, cert_senha_vault_id: null, api_key_vault_id: null,
}

test.describe('Conexões bancárias — erro do Sicredi com o que fazer (#88)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-sicredi-erro-claro-88', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('teste que falha mostra "Código de Acesso inválidos" e o Sicredi não oferece "Sincronizar extrato"', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)

    await page.route(/\/rest\/v1\/erp_banco_provider_config\?/, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([cfgSicredi]),
    }))
    await page.route(/\/rest\/v1\/erp_banco_teste_conexao\?/, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }))
    await page.route('**/api/banco/testar-conexao', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: false, status: 'erro', auth_ok: false, erro: ERRO_FC }),
    }))
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/financeiro/conexoes-bancarias')
    await aguardarConteudo(page)

    // extrato: Sicredi não tem conector ⇒ sem botão, com o caminho do OFX
    await expect(page.getByTestId('extrato-sem-conector-sicredi'), 'mostra o caminho do OFX').toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('extrato-sem-conector-sicredi')).toContainText('OFX')
    await expect(page.getByTestId('sincronizar-extrato-sicredi'), 'sem "Sincronizar extrato" para o Sicredi').toHaveCount(0)

    // teste de conexão que falha: frase do catálogo, não só o erro cru
    await page.getByRole('button', { name: /Testar conexão/ }).first().click()
    const res = page.getByTestId('teste-resultado-sicredi')
    await expect(res).toBeVisible({ timeout: 20000 })
    await expect(res, 'diz o que é').toContainText('Código de Acesso inválidos')
    await expect(res, 'diz o que fazer').toContainText(/gere novo Código de Acesso/i)
    await expect(res, 'mantém o erro do banco para suporte').toContainText('invalid_grant')
  })
})
