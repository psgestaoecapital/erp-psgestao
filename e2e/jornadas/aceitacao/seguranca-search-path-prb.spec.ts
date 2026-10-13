// 🚨 Segurança PR B (CEO 28/09) · 137 funções SECURITY DEFINER sem SET search_path: rodam como dono e resolvem
// nomes pelo caminho de quem chama. Migration 20260928210000 fixa "public, extensions, pg_temp" (o mesmo que o
// PostgREST já usa — nada muda de comportamento) e fn_seguranca_rls_auditar passa a acusar
// 'funcao_definer_sem_search_path' no briefing. Caminho principal: funções DEFINER públicas seguem achando as
// tabelas (portal do cliente da demo GE abre com dados; convite inexistente responde sem erro).

import { test, expect } from '../../support/fixtures'
import { rpc, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'

async function anon(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: r.status, corpo: await r.json().catch(() => null) }
}

test.describe('Segurança PR B · search_path fixo nas funções SECURITY DEFINER', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-search-path-prb', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('funções públicas seguem achando as tabelas (portal do cliente e convite)', async () => {
    const portal = await anon('fn_portal_cliente_obter', { p_company_id: DEMO_GE, p_token: 'demo-portal-ge-2608' })
    expect(portal.status, 'portal do cliente da demo GE').toBe(200)
    expect((portal.corpo as { ok?: boolean } | null)?.ok, 'portal devolve o fechamento da demo').toBe(true)
    const convite = await anon('fn_convite_ler', { p_code: 'e2e-convite-inexistente-prb' })
    expect(convite.status, 'convite inexistente responde sem erro').toBe(200)
    expect((convite.corpo as { ok?: boolean } | null)?.ok, 'convite inexistente: ok=false').toBe(false)
  })

  test('nenhuma SECURITY DEFINER sem search_path (auditoria do briefing)', { tag: '@pos-migration' }, async () => {
    const a = await rpc<Record<string, unknown>>('fn_seguranca_rls_auditar', {})
    expect(a.funcao_definer_sem_search_path, 'SECURITY DEFINER sem search_path').toEqual([])
    expect(a.ok, 'auditoria sem achados').toBe(true)
  })
})
