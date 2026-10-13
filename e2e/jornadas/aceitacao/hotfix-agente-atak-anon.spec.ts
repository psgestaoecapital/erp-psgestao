// 🚑 Hotfix (28/09) · a PR A tirou do anon as funções que o AGENTE ATAK instalado no cliente chama com a chave
// pública → coleta da Frioeste parada desde ~09:30. Migration 20260928213000 devolve só essas 4, que exigem token
// do agente. Prova: com a chave pública e token falso, as funções respondem "token inválido" (e não 401/42501);
// e a função do coletor antigo sem token (fn_atak_mapa_coletor) segue fechada.

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const TOKEN_FALSO = 'e2e-token-inexistente-hotfix-agente'

async function anon(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: r.status, corpo: (await r.json().catch(() => null)) as Record<string, unknown> | null }
}

test.describe('Hotfix · agente ATAK volta a falar com a nuvem', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hotfix-agente-atak-anon', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('agente com token falso recebe "token inválido" (a função responde)', async () => {
    const cfg = await anon('fn_atak_agente_config', { p_token: TOKEN_FALSO })
    expect(cfg.status, 'config do agente').toBe(200)
    expect(String(cfg.corpo?.erro ?? ''), 'token falso é recusado pela função').toMatch(/token/i)
    const hb = await anon('fn_agente_heartbeat', { p_token: TOKEN_FALSO, p_versao: 'e2e', p_hostname: 'e2e', p_ultima_carga: null, p_status: 'e2e' })
    expect(hb.status, 'heartbeat do agente').toBe(200)
    expect(hb.corpo?.ok, 'heartbeat com token falso não grava').toBe(false)
  })

  test('função do coletor antigo sem token segue fechada ao anon', async () => {
    const r = await anon('fn_atak_mapa_coletor', { p_company_id: '00000000-0000-4000-a000-0000000a7a01' })
    expect(r.status, 'fn_atak_mapa_coletor sem token').toBeGreaterThanOrEqual(400)
  })
})
