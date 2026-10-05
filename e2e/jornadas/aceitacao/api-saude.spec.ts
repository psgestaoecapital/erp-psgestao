// /api/saude · monitor de queda: rota pública responde 200 {ok:true,db_ms} sem dado sensível e sem cache.

import { test, expect } from '../../support/fixtures'

test.describe('API saúde', () => {
  test('GET /api/saude responde ok com db_ms, sem cache e sem segredo', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    expect(r.headers()['cache-control']).toContain('no-store')
    const j = await r.json()
    expect(j.ok).toBe(true)
    expect(typeof j.db_ms).toBe('number')
    expect(Object.keys(j).sort()).toEqual(['db_ms', 'ok'])
  })

  test('GET /api/saude é idempotente (2ª chamada igual)', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    expect((await r.json()).ok).toBe(true)
  })
})
