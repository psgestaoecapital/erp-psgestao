// 🚨 Segurança PR D (CEO 28/09) · policies USING(true): todo logado lia a tabela inteira (conciliação, Truth,
// sugestões de de-para, módulos e assinaturas de TODAS as empresas). Migration 20260928224000: leitura por empresa
// do usuário (get_user_company_ids) nas 9 tabelas com company_id; 6 internas só para a equipe PS; catálogos que
// seguem abertos ficam documentados no banco (COMMENT ON POLICY). Caminho principal: o robô segue lendo a
// conciliação e as assinaturas da demo GE. Negado: o robô (PS_ADMIN) não enxerga empresa RESTRITA — antes lia.

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'

async function comoRobo<T>(tabela: string, query: string): Promise<{ status: number; linhas: T[] }> {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  })
  return { status: r.status, linhas: r.ok ? ((await r.json()) as T[]) : [] }
}

test.describe('Segurança PR D · leitura por empresa no lugar de USING(true)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-using-true-prd', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('logado segue lendo a própria empresa (assinatura da demo GE)', async () => {
    const r = await comoRobo<{ company_id: string }>('tenant_subscriptions', `select=company_id&company_id=eq.${DEMO_GE}`)
    expect(r.status, 'tenant_subscriptions da demo GE').toBe(200)
    expect(r.linhas.length, 'demo GE tem plano (menu)').toBeGreaterThan(0)
  })

  test('empresa restrita some para quem não tem vínculo', { tag: '@pos-migration' }, async () => {
    const restritas = (await dbSelect<{ id: string }>('companies', 'select=id&restrita_ps_admin=eq.true')).map((c) => c.id)
    test.skip(restritas.length === 0, 'sem empresa restrita para provar')
    const vinc = (await dbSelect<{ company_id: string }>('user_companies',
      `select=company_id&user_id=eq.74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa`)).map((v) => v.company_id)
    const alvo = restritas.filter((id) => !vinc.includes(id))
    test.skip(alvo.length === 0, 'robô tem vínculo com todas as restritas')
    const lista = `(${alvo.join(',')})`
    for (const tabela of ['tenant_subscriptions', 'tenant_modules_active', 'erp_truth_alerts', 'psgc_depara_sugestoes', 'conciliacao_lote']) {
      const r = await comoRobo<{ company_id: string }>(tabela, `select=company_id&company_id=in.${lista}&limit=5`)
      expect(r.status, `${tabela}: leitura responde`).toBe(200)
      expect(r.linhas, `${tabela}: nada de empresa restrita`).toEqual([])
    }
  })
})
