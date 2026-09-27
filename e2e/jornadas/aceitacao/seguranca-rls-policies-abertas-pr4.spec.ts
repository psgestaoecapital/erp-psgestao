// 🚨 Segurança PR 4 (28/09) · policies "true" para PUBLIC (anon + logado) em tabelas que o anon alcançava:
// consentimentos LGPD (e-mail e IP de todos), linhas de negócio, rateio, grupos, câmbio, auditoria (anon forjava
// registro). Migration 20260928150000: anon sem acesso; o logado vê o que é da SUA empresa / o PRÓPRIO consentimento.

import { test, expect } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const TABELAS = ['lgpd_consentimentos', 'business_line_custos', 'business_line_receitas', 'business_line_keywords',
  'rateio_distribuicao', 'company_groups', 'exchange_rates', 'taxas_cambio', 'plans', 'dominio_bi']

async function sessao(): Promise<{ token: string; id: string }> {
  const s = JSON.parse(await obterSessionPayload()) as { access_token: string; user: { id: string } }
  return { token: s.access_token, id: s.user.id }
}

test.describe('Segurança PR 4 · policies abertas fechadas', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-rls-pr4', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('o logado segue lendo o próprio consentimento LGPD e os catálogos', async () => {
    const { token, id } = await sessao()
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lgpd_consentimentos?select=id&user_id=eq.${id}`, { headers: h })
    expect(r.status, 'consentimento próprio').toBe(200)
    const c = await fetch(`${SUPABASE_URL}/rest/v1/erp_gov_nfse_municipios?select=codigo_ibge&limit=1`, { headers: h })
    expect(c.status, 'catálogo de municípios').toBe(200)
    expect(((await c.json()) as unknown[]).length).toBe(1)
  })

  test('anon não lê nem grava; o logado só vê o próprio consentimento', { tag: '@pos-migration' }, async () => {
    const anon = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
    for (const t of TABELAS) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: anon })
      expect(r.status, `anon lendo ${t}`).toBeGreaterThanOrEqual(400)
    }
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/audit_log_global`, {
      method: 'POST', headers: { ...anon, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ tabela: 'teste_seguranca', acao: 'FORJADO' }),
    })
    expect(ins.status, 'anon forjando auditoria').toBeGreaterThanOrEqual(400)

    const { token, id } = await sessao()
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lgpd_consentimentos?select=user_id`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
    expect(r.status).toBe(200)
    const linhas = (await r.json()) as { user_id: string }[]
    expect(linhas.every((l) => l.user_id === id), 'só o próprio consentimento').toBe(true)
  })
})
