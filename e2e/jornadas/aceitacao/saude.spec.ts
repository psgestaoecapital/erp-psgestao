// /api/saude (CEO 05/10): rota pública para o monitor de queda. 200 {ok:true, db_ms} sem dado sensível, sem cache.
import { test, expect } from '@playwright/test'

test.describe('API de saúde', () => {
  test('GET /api/saude responde 200 {ok:true, db_ms} sem cache e sem segredo', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    const j = await r.json()
    expect(j.ok).toBe(true)
    expect(typeof j.db_ms).toBe('number')
    expect(Object.keys(j).sort()).toEqual(['db_ms', 'ok'])
    expect(r.headers()['cache-control']).toContain('no-store')
  })
})
