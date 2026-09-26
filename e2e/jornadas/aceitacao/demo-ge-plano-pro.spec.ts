// Decisão do CEO (26/09): a Demonstração Comércio (GE) tem o plano GE Pró completo para exercitar as telas do Pró
// (ex.: listagem de contas a pagar/receber). Só demonstração: nenhuma empresa real muda de plano.
// Migration 20260926300000 · @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO. Somente leitura.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

test.describe('Demonstração GE com o plano GE Pró', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-demo-ge-plano-pro', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('demo GE tem GE Pró ativo a R$ 0 e a listagem do Pró responde como o robô @pos-migration', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo).toBe(true)
    const subs = await dbSelect<{ status: string; monthly_price_brl: number }>('tenant_subscriptions',
      `company_id=eq.${DEMO_COMERCIO}&plan_id=eq.v15_gestao_empresarial_pro&select=status,monthly_price_brl`)
    expect(subs.filter((s) => s.status === 'active'), 'uma assinatura GE Pró ativa').toHaveLength(1)
    expect(Number(subs.find((s) => s.status === 'active')?.monthly_price_brl ?? -1), 'demonstração não entra no MRR').toBe(0)

    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const hoje = new Date()
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10)
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_ge_listagem_v2`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: DEMO_COMERCIO, p_tipo: 'pagar', p_data_inicio: ini, p_data_fim: fim }),
    })
    expect(resp.ok).toBe(true)
    const j = (await resp.json()) as { sem_plano?: boolean }
    expect(j.sem_plano, 'a listagem do Pró não pode responder sem_plano na demo').toBeFalsy()
  })
})
