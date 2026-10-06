// /api/saude (CEO 05/10): rota pública de sonda de queda. 200 {ok:true, db_ms} com o banco de pé, sem cache e sem
// dado sensível; 503 {ok:false} quando o banco não responde (simulado no servidor não — aqui só o caminho feliz e o formato).

import { test, expect } from '@playwright/test'

test.describe('API saúde', () => {
  test('GET /api/saude responde 200 {ok:true, db_ms} sem cache e sem segredos', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    expect(r.headers()['cache-control']).toContain('no-store')
    const j = await r.json()
    expect(Object.keys(j).sort()).toEqual(['db_ms', 'ok'])
    expect(j.ok).toBe(true)
    expect(typeof j.db_ms).toBe('number')
    expect(JSON.stringify(j)).not.toMatch(/eyJ|supabase|key/i)
  })

  test('segunda chamada seguida também responde 200 (idempotente)', async ({ request }) => {
    const r = await request.get('/api/saude')
    expect(r.status()).toBe(200)
    expect((await r.json()).ok).toBe(true)
  })
})
