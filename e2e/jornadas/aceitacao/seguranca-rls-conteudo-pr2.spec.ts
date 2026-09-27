// 🚨 Segurança PR 2 (28/09) · conteúdo e operação: 36 tabelas sem RLS e com GRANT total ao anon.
// Migration 20260928100000: anon não lê nenhuma; catálogos seguem legíveis ao logado; bpo_mensagens e
// projetos_servicos_bom seguem a RLS da tabela-mãe; interno PS só admin. Nada é gravado.

import { test, expect } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const AMOSTRA = ['bpo_mensagens', 'dev_chat', 'custos_industriais', 'epi_categoria', 'compliance_tipos_documento',
  'erp_banco_manifesto', 'erp_banco_erro_catalogo', 'lgpd_inventario_dados', 'lgpd_bases_legais', 'projetos_servicos_bom',
  'robo_budget_config', 'visual_truth_alerts']

test.describe('Segurança PR 2 · conteúdo e operação fechados ao anon', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-rls-pr2', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('logado segue lendo os catálogos que as telas usam', async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    for (const t of ['epi_categoria', 'compliance_tipos_documento', 'erp_banco_manifesto']) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=3`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
      expect(r.status, `logado lendo ${t}`).toBe(200)
      expect(((await r.json()) as unknown[]).length, `${t} tem linhas`).toBeGreaterThan(0)
    }
  })

  test('anon não lê nenhuma das tabelas', { tag: '@pos-migration' }, async () => {
    expect(SUPABASE_URL && ANON_KEY, 'ambiente com URL e chave anon').toBeTruthy()
    for (const t of AMOSTRA) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } })
      expect(r.status, `anon lendo ${t}`).toBeGreaterThanOrEqual(400)
    }
  })
})
