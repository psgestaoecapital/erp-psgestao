// /api/saude (CEO 05/10): rota pública para monitor de queda. Confere 200 {ok,db_ms}, sem cache e sem vazar segredo.
import { test, expect } from '@playwright/test'

test.describe('API saúde', () => {
  test('GET /api/saude responde 200 com ok e db_ms, sem cache e sem segredos', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    expect(r.headers()['cache-control']).toContain('no-store')
    const corpo = await r.json()
    expect(corpo.ok).toBe(true)
    expect(typeof corpo.db_ms).toBe('number')
    expect(Object.keys(corpo).sort()).toEqual(['db_ms', 'ok'])
  })

  test('GET /api/saude é estável em duas chamadas seguidas', async ({ request }) => {
    for (let i = 0; i < 2; i++) expect((await request.get('/api/saude')).status()).toBe(200)
  })
})
