// CEO 05/10 · /api/saude: rota pública para o monitor externo de queda. Sem dado sensível, sem cache.
import { test, expect } from '@playwright/test'

test.describe('API de saúde', () => {
  test('GET /api/saude responde 200 {ok:true, db_ms} sem cache', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    const j = await r.json()
    expect(j.ok).toBe(true)
    expect(typeof j.db_ms).toBe('number')
    expect(Object.keys(j).sort()).toEqual(['db_ms', 'ok'])
    expect(r.headers()['cache-control']).toContain('no-store')
  })

  test('GET /api/saude é público e repetível (idempotente)', async ({ request }) => {
    for (let i = 0; i < 2; i++) expect((await request.get('/api/saude')).status()).toBe(200)
  })
})
