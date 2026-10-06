// /api/saude (monitor de queda · CEO 05/10): 200 {ok:true, db_ms}, sem cache, sem segredo na resposta.
import { test, expect } from '../../support/fixtures'

test.describe('API saúde', () => {
  test('GET /api/saude responde 200 ok com db_ms e sem cache', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    expect(r.headers()['cache-control']).toContain('no-store')
    const j = await r.json()
    expect(j.ok).toBe(true)
    expect(typeof j.db_ms).toBe('number')
    expect(Object.keys(j).sort()).toEqual(['db_ms', 'ok'])
  })

  test('a resposta não vaza chave nem URL do banco', async ({ request }) => {
    const txt = await (await request.get('/api/saude')).text()
    expect(txt).not.toMatch(/supabase|eyJ|apikey|service_role/i)
  })
})
