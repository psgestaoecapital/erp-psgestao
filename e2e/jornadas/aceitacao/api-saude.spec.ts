// Monitor de queda · /api/saude (CEO 05/10): rota pública GET, 200 {ok:true,db_ms} com o banco de pé, sem dado
// sensível e sem cache. Não toca dado de cliente.

import { test, expect } from '../../support/fixtures'

test.describe('API saúde', () => {
  test('GET /api/saude responde 200 {ok:true, db_ms} sem cache e sem segredos', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    const corpo = await r.json()
    expect(corpo.ok).toBe(true)
    expect(typeof corpo.db_ms).toBe('number')
    expect(Object.keys(corpo).sort()).toEqual(['db_ms', 'ok'])
    expect(r.headers()['cache-control']).toContain('no-store')
  })

  test('segunda chamada seguida também responde 200 (idempotente)', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    expect((await r.json()).ok).toBe(true)
  })
})
