// /api/saude (CEO 05/10): rota pública do monitor de queda. Responde 200 {ok:true,db_ms} sem dado sensível e sem cache.
// Depende da fn_saude_ping (migration) → @pos-migration.

import { test, expect } from '@playwright/test'

test.describe('API saúde', () => {
  test('GET /api/saude responde ok com db_ms, sem cache e sem segredos', { tag: '@pos-migration' }, async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    const j = await r.json()
    expect(j.ok).toBe(true)
    expect(typeof j.db_ms).toBe('number')
    expect(Object.keys(j).sort()).toEqual(['db_ms', 'ok'])
    expect(r.headers()['cache-control']).toContain('no-store')
  })
})
