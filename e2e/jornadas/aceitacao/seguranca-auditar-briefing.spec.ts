// 🚨 Segurança (28/09) · fn_seguranca_rls_auditar passa a acusar TODA tabela sem RLS com anon (não só as com
// company_id), view legível por anon, view com direitos do dono e policy aberta ao anon — e entra no briefing.
// Migration 20260928130000. A lista de brechas deixa de ser executável pelo logado comum (só service_role/briefing).

import { test, expect } from '../../support/fixtures'
import { rpc, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

test.describe('Segurança · auditoria ampla no briefing', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-auditar-briefing', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('a auditoria de RLS segue respondendo (chaves de 26/09)', async () => {
    const a = await rpc<Record<string, unknown>>('fn_seguranca_rls_auditar', {})
    expect(Array.isArray(a.sem_rls_com_company_id), 'sem_rls_com_company_id').toBe(true)
    expect(Array.isArray(a.anon_com_escrita_em_tabela_de_empresa)).toBe(true)
  })

  test('acusa tabela sem RLS com anon, view do dono e policy aberta; só service_role', { tag: '@pos-migration' }, async () => {
    const a = await rpc<Record<string, unknown>>('fn_seguranca_rls_auditar', {})
    for (const k of ['tabela_sem_rls_com_anon', 'view_legivel_por_anon', 'view_com_direitos_do_dono', 'policy_aberta_para_anon']) {
      expect(Array.isArray(a[k]), k).toBe(true)
    }
    expect(typeof a.ok).toBe('boolean')
    expect(a.view_legivel_por_anon, 'nenhuma view legível por anon (#1877)').toEqual([])

    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_seguranca_rls_auditar`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(r.status, 'logado comum não lê a lista de brechas').toBeGreaterThanOrEqual(400)
  })
})
