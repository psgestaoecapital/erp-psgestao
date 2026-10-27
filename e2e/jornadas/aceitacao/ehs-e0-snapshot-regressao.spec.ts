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
    // CPF = exatamente 11 dígitos; fronteira (?<!\d)...(?!\d) para NÃO casar dentro de um UUID
    // (o company_id da DEMO termina em ...000000000005 — 12 dígitos — e tropeçava na regex). Um CPF real
    // ("cpf":"12345678901") continua pego; o teste fica mais preciso, não mais fraco.
    // Os hashes md5 (32 hex) e UUIDs também podem conter 11 dígitos seguidos entre letras (falso positivo
    // que depende do dado): remove-os antes de procurar CPF.
    const semHash = JSON.stringify(s1)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
      .replace(/[0-9a-f]{32}/gi, '')
    expect(semHash, 'sem nome/CPF').not.toMatch(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/)
    const anon = await rpc(ANON)
    expect(anon.status, 'anon não executa').toBeGreaterThanOrEqual(401)
  })
})
