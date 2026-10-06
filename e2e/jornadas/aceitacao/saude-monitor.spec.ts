// /api/saude (CEO 05/10): rota pública para o monitor de queda — 200 {ok,db_ms} sem dado sensível e sem cache.
import { test, expect } from '../../support/fixtures'

test.describe('API saúde', () => {
  test('responde 200 {ok:true, db_ms} sem cache e sem segredo', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    const j = await r.json()
    expect(j.ok).toBe(true)
    expect(typeof j.db_ms).toBe('number')
    expect(Object.keys(j).sort()).toEqual(['db_ms', 'ok'])
    expect(r.headers()['cache-control']).toContain('no-store')
  })

  test('não exige login (rota pública)', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL })
    const r = await ctx.get('/api/saude')
    expect([200, 503]).toContain(r.status())
    expect((await r.json()).ok === true || r.status() === 503).toBe(true)
    await ctx.dispose()
  })
})
