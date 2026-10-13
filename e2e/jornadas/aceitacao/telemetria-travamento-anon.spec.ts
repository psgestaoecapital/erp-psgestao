// Telemetria de travamento sem sessão (CEO 28/09). Antes: navegador sem login recebia 401 ao registrar travamento
// (o registro se perdia). Migration 20260928223000: anon grava, com limite de 20/min por IP (fn_telemetria_estourou).
// Caminho principal: o robô logado segue registrando. Sem sessão: a função responde (200) em vez de 401 — com rótulo
// vazio, para não gravar linha de teste em produção.

import { test, expect } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

async function chamar(bearer: string, label: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_registrar_travamento`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_label: label, p_duracao_ms: 1, p_timeout: false, p_company_id: null, p_user_agent: 'e2e', p_rota: '/e2e', p_bundle_version: 'e2e' }),
  })
  return { status: r.status, corpo: await r.json().catch(() => null) }
}

test.describe('Telemetria · travamento registrado também sem sessão', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-telemetria-travamento-anon', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('logado segue registrando travamento', async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const r = await chamar(token, '')
    expect(r.status, 'logado chama a telemetria').toBe(200)
  })

  test('sem sessão a telemetria responde (não 401)', { tag: '@pos-migration' }, async () => {
    const r = await chamar(ANON_KEY, '')
    expect(r.status, 'anon chama a telemetria').toBe(200)
  })
})
