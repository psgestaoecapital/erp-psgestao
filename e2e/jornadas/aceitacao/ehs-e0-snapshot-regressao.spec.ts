// PS EHS · E0 regressão por DADO: fn_ehs_snapshot_regressao devolve só números/hashes, é estável (duas leituras
// seguidas iguais) e não é executável por anon. Demonstração Indústria (SST); só leitura.

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const URL_SB = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

async function rpc(chave: string) {
  return fetch(`${URL_SB}/rest/v1/rpc/fn_ehs_snapshot_regressao`, {
    method: 'POST',
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_company_id: DEMO_SST }),
  })
}

test.describe('PS EHS E0 — snapshot de regressão', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('ehs-e0-snapshot-regressao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('service_role lê o snapshot (estável, sem dado pessoal) e anon é barrado', { tag: '@pos-migration' }, async () => {
    const a = await rpc(SERVICE)
    expect(a.status, await a.clone().text()).toBe(200)
    const s1 = await a.json()
    const s2 = await (await rpc(SERVICE)).json()
    expect(s2, 'duas leituras seguidas iguais').toEqual(s1)
    expect(s1.company_id).toBe(DEMO_SST)
    expect(typeof s1.funcionarios.total).toBe('number')
    expect(s1.funcionarios.hash).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.stringify(s1), 'sem nome/CPF').not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/)
    const anon = await rpc(ANON)
    expect(anon.status, 'anon não executa').toBeGreaterThanOrEqual(401)
  })
})
