// HOTFIX (28/09 tarde) · o sync agendado do Omie (pg_cron → fn_sync_empresa → /api/omie/sync) tomava 401 desde 28/09
// 01:00 UTC: a rota passou a exigir login e o banco chama sem sessão. Agora o banco manda a service key (mesmo
// padrão de /api/cron/ponto-diario) e a rota aceita essa chamada de máquina; as chaves do Omie vêm do Vault.
// Nenhum teste transporta segredo do Omie — a demo GE não tem credencial Omie (resposta esperada: "salve em Conectores").

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'

test.describe('Hotfix · sync agendado do Omie volta a autenticar', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hotfix-omie-sync-cron', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('chamada de máquina (como o pg_cron faz) passa pela guarda e lê as chaves do Vault', async ({ request }) => {
    const r = await request.post('/api/omie/sync', {
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      data: { company_id: DEMO_GE, sync_type: 'all' },   // igual ao corpo do fn_sync_empresa: sem app_key/app_secret
    })
    expect(r.status(), 'não é mais 401 — a guarda aceita o serviço').not.toBe(401)
    expect(r.status(), 'demo sem Omie no Vault → 400').toBe(400)
    expect(String((await r.json()).error ?? ''), 'pediu para salvar em Conectores (leu o Vault, não achou)').toMatch(/Conectores/)
  })

  test('sem autorização continua 401 (a rota não reabriu)', async ({ request }) => {
    const semAuth = await request.post('/api/omie/sync', { data: { company_id: DEMO_GE, sync_type: 'all' } })
    expect(semAuth.status()).toBe(401)
    const outroBearer = await request.post('/api/omie/sync', {
      headers: { Authorization: 'Bearer nao-e-a-chave' }, data: { company_id: DEMO_GE, sync_type: 'all' },
    })
    expect(outroBearer.status(), 'bearer qualquer não vira máquina').toBe(401)
  })
})
