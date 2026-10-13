// Defeito achado pelo veredito @pos-migration da #1955 (#552, 01/10): na 1ª abertura dos leads, fn_agency_origens_listar
// semeia a lista padrão de origens — e quebrava com 42702 ("chave" ambíguo). Migration 20261001160000 (@pos-migration).
// Prova na Agência (P&M) - DEMO, pela mesma RPC que a tela chama: a lista vem (200) com as origens padrão e chamar de
// novo não duplica. Nada de cliente real é tocado.

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

async function listar() {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_agency_origens_listar`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_company_id: DEMO_AG }),
  })
  return { status: r.status, corpo: (await r.json().catch(() => null)) as unknown }
}

test.describe('Leads da agência: lista de origens abre na 1ª vez (semente)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agency-origens-semente', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('lista de origens vem com as padrões e não duplica', { tag: '@pos-migration' }, async () => {
    const a = await listar()
    expect(a.status, JSON.stringify(a.corpo)).toBe(200)
    const chaves = (a.corpo as { chave: string }[]).map((o) => o.chave)
    for (const c of ['whatsapp', 'site', 'ligacao', 'email', 'evento']) expect(chaves, `oferece ${c}`).toContain(c)
    const b = await listar()
    expect(b.status).toBe(200)
    expect((b.corpo as unknown[]).length, '2ª chamada não duplica').toBe((a.corpo as unknown[]).length)
    const linhas = await dbSelect<{ chave: string }>('agency_lead_origem', `company_id=eq.${DEMO_AG}&select=chave`)
    expect(new Set(linhas.map((l) => l.chave)).size, 'sem chave repetida na tabela').toBe(linhas.length)
  })
})
