// Pdois (Marciana, 07/10): o responsável do job saía vazio na Pauta porque a RLS de users escondia o colega.
// Migration 20261007212005 → @pos-migration. Como o robô (usuário da empresa DEMO, não admin): todo job da Pauta cujo
// responsavel_id é usuário vinculado à empresa precisa vir com o NOME em "responsavel" (RD-82: teste como usuário da empresa).

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

test.describe('Pauta · nome do responsável para quem é da empresa', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pauta-responsavel-empresa', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('jobs com responsável da empresa mostram o nome', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const call = async (fn: string, args: Record<string, unknown>) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      return { status: r.status, corpo: await r.json() }
    }
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_PM}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const usu = await call('fn_usuarios_da_empresa', { p_company_id: DEMO_PM })
    expect(usu.status).toBe(200)
    const nomes = new Map<string, string>((usu.corpo as { id: string; full_name: string | null }[])
      .filter((u) => u.full_name?.trim()).map((u) => [u.id, u.full_name!.trim()]))
    const lista = await call('fn_pauta_listar', { p_company_id: DEMO_PM, p_filtros: {}, p_por_pagina: 500 })
    expect(lista.status).toBe(200)
    const itens = (lista.corpo as { itens: { responsavel_id: string | null; responsavel: string | null }[] }).itens
    const comResp = itens.filter((i) => i.responsavel_id && nomes.has(i.responsavel_id))
    expect(comResp.length, 'a demo tem job com responsável da empresa').toBeGreaterThan(0)
    for (const i of comResp) expect(i.responsavel, `responsável ${i.responsavel_id}`).toBeTruthy()
  })
})
