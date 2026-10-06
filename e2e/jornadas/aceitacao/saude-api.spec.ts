// /api/saude · rota pública para o monitor de queda (CEO 05/10). Sem login: 200 {ok:true, db_ms} sem nenhum outro
// campo (nada sensível), cache desligado. Só leitura.

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

test.describe('Saúde — /api/saude', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-saude-api', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('anônimo → 200 {ok:true, db_ms} sem dado sensível e sem cache', async ({ request }) => {
    const resp = await request.get('/api/saude')
    expect(resp.status()).toBe(200)
    expect(resp.headers()['cache-control'] ?? '').toContain('no-store')
    const corpo = await resp.json() as Record<string, unknown>
    expect(corpo.ok).toBe(true)
    expect(typeof corpo.db_ms).toBe('number')
    expect(Object.keys(corpo).sort()).toEqual(['db_ms', 'ok'])
  })
})
