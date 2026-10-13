// #287 (Gean) · ao importar o retorno, o sistema avisava que o banco não confirmou um título, mas não dizia QUAL: só a
// descrição e a remessa. Caso real (KGF, remessa 65, 25/09): código ZI num título da SINUELO de R$ 1.984,22 com
// vencimento 01/10 — e o Gean achou que era da Scherer. Agora a fila de revisão e o resultado da importação mostram
// fornecedor · valor · vencimento · remessa · código do banco (linhaTituloRetorno, conferida no build).
// Demonstração Comércio (GE): a demo não tem banco configurado nem remessa (trava de demo), então a configuração do
// banco e a fila de revisão vêm simuladas; o resto da tela roda de verdade. Nada é gravado.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const CFG = [{ id: '00000000-0000-4000-a000-000000000287', provider: 'sicoob', ambiente: 'homologacao', cooperativa: '3069', agencia_dv: '1', conta: '12345', convenio: '999', cap_pagamento: true, ativo: true }]

async function abrir(page: import('@playwright/test').Page, fila: unknown[]) {
  await page.route(/\/rest\/v1\/erp_banco_provider_config\?/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CFG) }))
  await page.route(/\/rest\/v1\/erp_remessa_pagamento_item\?.*status_item=eq\.nao_reconhecido/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fila) }))
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
  await page.goto('/dashboard/financeiro/remessa-pagamento')
  await aguardarConteudo(page)
}

test.describe('#287 · retorno de remessa: qual título o banco não confirmou', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-287-retorno-titulo-nao-reconhecido', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('caminho principal: a fila de revisão diz fornecedor, valor, vencimento, remessa e código do banco', async ({ page }) => {
    await abrir(page, [{
      id: '00000000-0000-4000-a000-00000000a287', valor: 1984.22, ocorrencia_retorno: '000/ZI',
      remocao_motivo: 'o banco devolveu codigo que o sistema nao conhece: ZI',
      erp_pagar: { descricao: 'SINUELO AUTO PECAS', fornecedor_nome: 'SINUELO AUTO PECAS', data_vencimento: '2026-10-01' },
      erp_remessa_pagamento: { numero_sequencial: 65, company_id: DEMO_GE },
    }])
    const linha = page.getByTestId('retorno-naorec-titulo')
    await expect(linha, 'o título não confirmado aparece identificado').toBeVisible({ timeout: 20000 })
    await expect(linha).toContainText('SINUELO AUTO PECAS')
    await expect(linha).toContainText('R$ 1.984,22')
    await expect(linha).toContainText('vence 01/10/2026')
    await expect(linha).toContainText('remessa Nº 65')
    await expect(linha).toContainText('código do banco 000/ZI')
  })

  test('sem título pendente de revisão, o alerta não aparece', async ({ page }) => {
    await abrir(page, [])
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('retorno-naorec-titulo')).toHaveCount(0)
  })
})
