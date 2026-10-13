// 🚨 Segurança PR 5 (28/09) · convites. "Anyone can read invite" deixava qualquer um, sem login, listar TODOS os
// convites (código, e-mail, papel) — convite sem e-mail era aceito por quem chegasse primeiro. Migration
// 20260928160000: leitura só pelo código (fn_convite_ler), aceite só logado e para o próprio e-mail
// (fn_convite_aceitar); a tabela some para o anon. Somente leitura — nenhum convite é criado ou consumido.

import { test, expect } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const anon = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }

test.describe('Segurança PR 5 · convites só pelo código', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-convite-pr5', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('link de convite inválido mostra "Convite Inválido" (página pública segue de pé)', async ({ page }) => {
    await page.goto('/convite?code=codigo-que-nao-existe-e2e')
    await expect(page.getByText('Convite Inválido')).toBeVisible({ timeout: 20000 })
  })

  test('anon não lista convites; lê só pelo código; aceitar exige login', { tag: '@pos-migration' }, async () => {
    const lista = await fetch(`${SUPABASE_URL}/rest/v1/invites?select=invite_code&limit=1`, { headers: anon })
    expect(lista.status, 'anon listando invites').toBeGreaterThanOrEqual(400)

    const ler = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_convite_ler`, { method: 'POST', headers: anon, body: JSON.stringify({ p_code: 'codigo-que-nao-existe-e2e' }) })
    expect(ler.status).toBe(200)
    expect(((await ler.json()) as { ok: boolean }).ok, 'código inexistente').toBe(false)

    const aceitar = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_convite_aceitar`, { method: 'POST', headers: anon, body: JSON.stringify({ p_code: 'codigo-que-nao-existe-e2e' }) })
    expect(aceitar.status, 'anon aceitando convite').toBeGreaterThanOrEqual(400)

    // logado: só convites das SUAS empresas; aceitar código inexistente não faz nada
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const minhas = (await (await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_user_company_ids`, { method: 'POST', headers: h, body: '{}' })).json()) as unknown[]
    const ids = new Set(minhas.map((x) => (typeof x === 'string' ? x : Object.values(x as Record<string, string>)[0])))
    const vistos = (await (await fetch(`${SUPABASE_URL}/rest/v1/invites?select=company_id`, { headers: h })).json()) as { company_id: string | null }[]
    expect(vistos.every((v) => v.company_id !== null && ids.has(v.company_id)), 'só convites das minhas empresas').toBe(true)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_convite_aceitar`, { method: 'POST', headers: h, body: JSON.stringify({ p_code: 'codigo-que-nao-existe-e2e' }) })
    expect(r.status).toBe(200)
    expect(((await r.json()) as { ok: boolean; erro?: string }).erro).toBe('convite_invalido')
  })
})
