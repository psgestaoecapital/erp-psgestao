// IBPT por empresa (CEO 28/09) · Configurações › Fiscal › "Tributos aproximados (IBPT · Lei 12.741)".
// A empresa cadastra o token dela; "Salvar e testar" consulta o IBPT pelo servidor e só guarda se o IBPT aceitar.
// Sem token (ou com erro), as notas usam a tabela genérica do IBPT (fiscal_ibpt_aliquota) — a reserva de prazo do CEO.
// O token nunca volta para a tela e nunca aparece no teste: aqui só se prova que um token que não passou no teste
// NÃO é guardado. Demonstração Comércio (GE), que não tem CNPJ nem token — nada é gravado.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'

async function credenciaisIbpt(): Promise<number> {
  const r = await dbSelect<{ id: string }>('erp_credencial', `provider=eq.ibpt&company_id=eq.${DEMO_GE}&select=id`)
  return r.length
}

test.describe('IBPT por empresa · token na Configuração Fiscal', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    expect(await credenciaisIbpt(), 'a demo começa sem token do IBPT').toBe(0)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-ibpt-empresa-token', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('caminho principal: sem token, a tela mostra que as notas usam a tabela genérica do IBPT', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/configuracoes/fiscal')
    await aguardarConteudo(page)
    const card = page.getByTestId('ibpt-token-card')
    await expect(card).toBeVisible({ timeout: 20000 })
    await expect(card.getByTestId('ibpt-estado')).toContainText('Sem token — usando a tabela genérica do IBPT', { timeout: 15000 })
    await expect(card.getByTestId('ibpt-token-input'), 'campo do token é de senha (não aparece na tela)').toHaveAttribute('type', 'password')
    await expect(card.getByTestId('ibpt-salvar-testar'), 'sem token digitado, não testa').toBeDisabled()
  })

  test('token que não passou no teste não é guardado', async ({ page, request }) => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const h = { Authorization: `Bearer ${token}` }

    const curto = await request.post('/api/fiscal/ibpt-token', { headers: h, data: { companyId: DEMO_GE, token: 'abc' } })
    expect(curto.status(), 'token incompleto é recusado').toBe(400)

    // pela tela: a demo não tem CNPJ, então o teste no IBPT nem é feito e nada é guardado
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/configuracoes/fiscal')
    await aguardarConteudo(page)
    const card = page.getByTestId('ibpt-token-card')
    await expect(card.getByTestId('ibpt-estado')).toContainText('Sem token', { timeout: 20000 })
    await card.getByTestId('ibpt-token-input').fill('e2e-token-que-nao-vale-0000')
    await card.getByTestId('ibpt-salvar-testar').click()
    await expect(card.getByTestId('ibpt-msg')).toContainText('Complete o CNPJ', { timeout: 20000 })
    await expect(card.getByTestId('ibpt-teste-resultado')).toHaveCount(0)
    await expect(card.getByTestId('ibpt-estado')).toContainText('Sem token')
    expect(await credenciaisIbpt(), 'nada foi guardado').toBe(0)

    const g = await request.get(`/api/fiscal/ibpt-token?companyId=${DEMO_GE}`, { headers: h })
    const est = await g.json() as { ok: boolean; configurado: boolean; generica: { versao: string | null } | null; token?: unknown }
    expect(g.status()).toBe(200)
    expect(est.configurado).toBe(false)
    expect(est.generica?.versao, 'tabela genérica vigente').toBeTruthy()
    expect(JSON.stringify(est), 'o estado nunca devolve token').not.toMatch(/"token"/)
  })

  test('banco: cache do IBPT, status do token e fonte gravada na nota existem', { tag: '@pos-migration' }, async () => {
    await dbSelect('erp_ibpt_cache', 'select=company_id,tipo,codigo,nacional,importado,estadual,municipal,versao,vigencia_fim,fonte&limit=1')
    await dbSelect('erp_ibpt_empresa_status', 'select=company_id,token_salvo_em,ultima_consulta_ok,ultimo_erro&limit=1')
    const cfg = await dbSelect<{ ibpt_empresa_nas_notas: boolean }>('erp_fiscal_provider_config', 'select=ibpt_empresa_nas_notas&limit=50')
    expect(cfg.every((c) => c.ibpt_empresa_nas_notas === false), 'uso nas notas começa desligado em todas as empresas').toBe(true)
    await dbSelect('erp_nfse_emitidas', 'select=ibpt_fonte&limit=1')
    await dbSelect('erp_nfe_emitidas', 'select=ibpt_fonte&limit=1')
  })
})
