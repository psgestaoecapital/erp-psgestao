// /api/saude (monitor de queda, CEO 05/10): rota pública, só leitura, sem segredo na resposta, cache desligado.

import { test, expect } from '@playwright/test'

test.describe('API saúde', () => {
  test('responde 200 {ok:true, db_ms} sem cache e sem dado sensível', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    const j = await r.json()
    expect(j.ok).toBe(true)
    expect(typeof j.db_ms).toBe('number')
    expect(Object.keys(j).sort()).toEqual(['db_ms', 'ok'])
    expect(r.headers()['cache-control']).toContain('no-store')
  })

  test('não aceita escrita (só GET)', async ({ request }) => {
    const r = await request.post('/api/saude', { data: {} })
    expect(r.status()).toBe(405)
  })
})
