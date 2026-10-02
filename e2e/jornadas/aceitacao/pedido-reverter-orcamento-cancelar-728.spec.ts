// #728 · Pedido reversível a orçamento + cancelamento no orçamento.
// As RPCs fn_pedido_reverter_para_orcamento e fn_orcamento_cancelar só existem APÓS a migration
// (20261002110000 / 20261002130000). No preview (antes do merge) o banco é o ATUAL: a função não existe
// e o PostgREST responde PGRST202 (404) → este teste fica VERMELHO informativo no aceitacao-pr.yml e é o
// VEREDITO no aceitacao-pos-migration.yml (produção, após o deploy-migrations). Daí a tag @pos-migration.
//
// Prova leve e determinística: a função EXISTE e roda (guarda "não encontrado" com id inexistente),
// em vez de depender de dados de pedido/orçamento reais da base.

import { test, expect } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const NADA = '00000000-0000-4000-a000-00000000728e'

test.describe('#728 · reverter pedido para orçamento + cancelar orçamento', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pedido-reverter-cancelar-728', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('as RPCs do #728 existem e rodam (pós-migration)', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    // 1) fn_pedido_reverter_para_orcamento existe → id inexistente cai na guarda "Pedido nao encontrado".
    {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_pedido_reverter_para_orcamento`, {
        method: 'POST', headers: h, body: JSON.stringify({ p_pedido_id: NADA }),
      })
      const b = (await r.json().catch(() => ({}))) as { code?: string; message?: string }
      expect(b.code, 'função deve existir (não PGRST202)').not.toBe('PGRST202')
      expect(`${b.message ?? ''}`.toLowerCase(), 'guarda de pedido inexistente').toContain('encontrado')
    }

    // 2) fn_orcamento_cancelar existe → id inexistente cai na guarda "Orçamento não encontrado".
    {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_orcamento_cancelar`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ p_orcamento_id: NADA, p_motivo_perda_id: NADA, p_motivo_texto: 'e2e' }),
      })
      const b = (await r.json().catch(() => ({}))) as { code?: string; message?: string }
      expect(b.code, 'função deve existir (não PGRST202)').not.toBe('PGRST202')
      expect(`${b.message ?? ''}`.toLowerCase(), 'guarda de orçamento inexistente').toContain('encontrado')
    }
  })
})
