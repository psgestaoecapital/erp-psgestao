// CEO 28/09 (item 7) · Omie: a busca de pedidos de venda era recusada nas 4 empresas desde 04/06/2026
// ("Tag [FILTRAR_POR_ETAPA] não faz parte de pvpListarRequest") e a R.R, que não tem estoque no Omie, registrava
// falha de estoque ("Não existem registros para a página [1]") a cada hora. Correção: o filtro é "etapa" e lista
// vazia é zero registros, não falha. A prova chama a rota do mesmo jeito que o sync agendado faz de hora em hora
// (service key, sem chave do Omie no corpo — ela vem do Vault no servidor) para a R.R, só nos módulos corrigidos;
// nenhum segredo passa pelo teste e o efeito é o mesmo do cron (atualiza omie_imports da própria empresa).

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const RR = 'd1330faf-78f8-40fc-904f-711a6e4b7352'   // R. R Serviços e Acabamentos (sem estoque no Omie)

type Sync = { success?: boolean; counts?: Record<string, number>; failures?: Record<string, string>; error?: string }

async function sync(request: import('@playwright/test').APIRequestContext, sync_type: string): Promise<Sync> {
  const r = await request.post('/api/omie/sync', {
    headers: { Authorization: `Bearer ${SERVICE_KEY}` }, data: { company_id: RR, sync_type }, timeout: 120_000,
  })
  const corpo = await r.json() as Sync
  expect(r.status(), JSON.stringify(corpo)).toBe(200)
  return corpo
}

test.describe('Omie · pedidos de venda e estoque vazio', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-omie-vendas-estoque-vazio', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('pedidos de venda: o Omie aceita o filtro e a lista chega (sem falha)', async ({ request }) => {
    const r = await sync(request, 'vendas')
    expect(r.failures?.vendas, 'Omie não recusa mais a busca de pedidos').toBeUndefined()
    expect(typeof r.counts?.vendas, 'contagem de pedidos gravada').toBe('number')
  })

  test('caminho principal: estoque vazio é zero registros, não falha', async ({ request }) => {
    const r = await sync(request, 'estoque')
    expect(r.failures?.estoque, 'lista vazia do Omie não é falha').toBeUndefined()
    expect(r.counts?.estoque, 'R.R não tem estoque no Omie').toBe(0)
  })
})
