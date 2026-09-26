// RD-78 · Aceitação do chamado #122 (R.R · Rodrigo): "ao arrastar o orçamento e confirmar a conversão em pedido,
// não passa para o próximo campo" + "somente deixa converter após marcar como enviado; esse passo pode ser extinto".
// Migration 20260926290000: fn_converter_orcamento_em_pedido converte de qualquer etapa aberta (rascunho incluso),
// com trava de empresa. @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
// Demonstração Comércio (GE). A RPC é chamada COMO O ROBÔ (mesmo caminho do Kanban). Dados de teste excluídos (soft).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

test.describe('Aceitação #122 — orçamento vira pedido a partir do rascunho', () => {
  let token = ''
  let orc = ''
  let pedido = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-122-converter-rascunho', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    orc = (await dbInsert<{ id: string }>('erp_orcamentos', {
      company_id: DEMO_COMERCIO, numero: `ACEITE-122-${RUN}`, cliente_nome: 'Cliente Aceitação 122', status: 'rascunho',
      subtotal: 150, total: 150,
    })).id
    await dbInsert('erp_orcamentos_itens', {
      company_id: DEMO_COMERCIO, orcamento_id: orc, ordem: 1, produto_nome: 'Item aceitação 122',
      quantidade: 3, preco_unitario: 50, subtotal: 150,
    })
  })

  test.afterAll(async () => {
    if (pedido) await dbPatch('erp_pedidos', `id=eq.${pedido}`, { deleted_at: new Date().toISOString() }).catch(() => {})
    if (orc) await dbPatch('erp_orcamentos', `id=eq.${orc}`, { deleted_at: new Date().toISOString() }).catch(() => {})
  })

  test('orçamento em RASCUNHO converte em pedido (sem precisar marcar "enviado") @pos-migration', async () => {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_converter_orcamento_em_pedido`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_orcamento_id: orc }),
    })
    expect(resp.ok, `conversão a partir do rascunho: ${resp.status} ${await resp.clone().text()}`).toBe(true)
    pedido = (await resp.json()) as string
    const [p] = await dbSelect<{ orcamento_origem_id: string; status: string; total: number }>('erp_pedidos', `id=eq.${pedido}&select=orcamento_origem_id,status,total`)
    expect(p).toMatchObject({ orcamento_origem_id: orc, status: 'aberto' })
    expect(Number(p.total)).toBe(150)
    const itens = await dbSelect('erp_pedidos_itens', `pedido_id=eq.${pedido}&select=id`)
    expect(itens, 'os itens do orçamento vão para o pedido').toHaveLength(1)
    const [o] = await dbSelect<{ status: string; pedido_id: string }>('erp_orcamentos', `id=eq.${orc}&select=status,pedido_id`)
    expect(o).toMatchObject({ status: 'convertido', pedido_id: pedido })
  })

  test('anônimo não converte orçamento (a função não é pública) @pos-migration', async () => {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_converter_orcamento_em_pedido`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_orcamento_id: orc }),
    })
    expect(resp.ok, 'anon não pode executar').toBe(false)
  })
})
