// Monitor de queda · /api/saude é pública, leve e sem dado sensível. Só leitura.

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

test.describe('Saúde — /api/saude para o monitor externo', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('saude-monitor-queda', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('anônimo → 200 {ok:true, db_ms} sem cache e sem outros campos', async ({ request }) => {
    const resp = await request.get('/api/saude')
    expect(resp.status()).toBe(200)
    expect(resp.headers()['cache-control']).toContain('no-store')
    const corpo = await resp.json() as Record<string, unknown>
    expect(Object.keys(corpo).sort()).toEqual(['db_ms', 'ok'])
    expect(corpo.ok).toBe(true)
    expect(typeof corpo.db_ms).toBe('number')
  })

  test('segunda chamada seguida também responde 200 (idempotente)', async ({ request }) => {
    const resp = await request.get('/api/saude')
    expect(resp.status()).toBe(200)
    expect((await resp.json() as { ok?: boolean }).ok).toBe(true)
  })
})
