// 🚨 Segurança PR 3 (28/09) · backups, debug e auditoria interna: 46 tabelas sem RLS e com GRANT total ao anon.
// Migration 20260928120000: anon não lê nenhuma; o cliente logado não vê nenhuma (as telas internas PS ficam só
// para o administrador PS); nada é apagado. O catálogo de indicadores segue servido pela RPC (Central de Metas).

import { test, expect } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const AMOSTRA = ['_rbac_bkp_permissoes', 'bkp_clientes_enquadramento_20260923', '_debug_synclog', '_probe_iopoint',
  'gold_camada2_validacoes', 'system_screens', 'system_screens_history', 'erp_handoff_sessao', 'rd38_cron_falhas',
  'pem_roadmap_prs', 'ge_roadmap_prs', 'manual_vivo_diario', 'area_indicadores_mestres']

async function tokenBot(): Promise<string> {
  return (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
}

test.describe('Segurança PR 3 · tabelas internas fechadas', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-rls-pr3', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('a Central de Metas segue lendo o catálogo de indicadores pela RPC', async () => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_meta_listar`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${await tokenBot()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: DEMO_GE, p_tema: null }),
    })
    expect(r.status, 'RPC do catálogo').toBe(200)
    const d = (await r.json()) as { ok?: boolean; indicadores?: unknown[] }
    expect(d.ok).toBe(true)
    expect(d.indicadores?.length ?? 0, 'catálogo com indicadores').toBeGreaterThan(0)
  })

  test('anon não lê e o cliente logado não vê as tabelas internas', { tag: '@pos-migration' }, async () => {
    expect(SUPABASE_URL && ANON_KEY, 'ambiente com URL e chave anon').toBeTruthy()
    for (const t of AMOSTRA) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } })
      expect(r.status, `anon lendo ${t}`).toBeGreaterThanOrEqual(400)
    }
    // o robô é usuário de cliente (não é administrador PS): 0 linhas nas internas
    const token = await tokenBot()
    for (const t of ['system_screens', 'erp_handoff_sessao', 'bkp_clientes_enquadramento_20260923', 'ge_roadmap_prs']) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
      expect(r.status, `logado lendo ${t}`).toBe(200)
      expect(((await r.json()) as unknown[]).length, `${t} invisível ao cliente`).toBe(0)
    }
  })
})
