// Segurança · rotas /api que usam service_role (ignoram RLS) e eram ANÔNIMAS.
// Agora exigem Bearer do usuário (401 sem token), acesso à empresa via get_user_company_ids() (403 fora)
// e as internas exigem admin PS. Aqui: (1) caminho feliz — o bot logado lê a Demonstração Comércio;
// (2) anônimo não passa em /api/dev/sql nem em /api/financeiro. Só leitura: nada é gravado.

import { test, expect } from '../../support/fixtures'
import { registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Segurança — rotas /api com service_role exigem login e empresa', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('seguranca-api-rotas-anonimas', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('logado na empresa demo → /api/financeiro responde 200', async ({ request }) => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const resp = await request.get(`/api/financeiro?company_id=${DEMO_COMERCIO}&tipo=clientes&limite=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const corpo = await resp.json() as { success?: boolean; error?: string }
    expect(resp.status(), JSON.stringify(corpo)).toBe(200)
    expect(corpo.success).toBe(true)
  })

  test('anônimo → /api/dev/sql e /api/financeiro recusam', async ({ request }) => {
    const sql = await request.post('/api/dev/sql', { data: { query: 'SELECT id FROM dominio_bi' } })
    expect([401, 403], `dev/sql anônimo respondeu ${sql.status()}`).toContain(sql.status())
    const corpoSql = await sql.json() as { ok?: boolean; data?: unknown }
    expect(corpoSql.ok).toBe(false)
    expect(corpoSql.data).toBeUndefined()

    const fin = await request.get(`/api/financeiro?company_id=${DEMO_COMERCIO}`)
    expect(fin.status()).toBe(401)
    expect((await fin.json() as { ok?: boolean }).ok).toBe(false)
  })
})
