// DRE (Eng. Chefe 07/10): conta nova do plano sem de-para herda o vínculo da conta pai; helper fechado ao anon.
// Caminho principal: logado chama fn_psgc_contas_sem_vinculo e recebe {ok, qtd, contas}.
import { test, expect } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const NADA = '00000000-0000-4000-a000-00000000e2e0'

async function rpcComo(chave: string, fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: r.status, corpo: (await r.json().catch(() => null)) as { code?: string; ok?: boolean; qtd?: number } | null }
}

test.describe('DRE · de-para herdado da conta pai', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-dre-depara-herdado-pai', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('logado recebe o aviso de contas sem vínculo', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const r = await rpcComo(token, 'fn_psgc_contas_sem_vinculo', { p_company_id: NADA })
    expect(r.status).toBe(200)
    expect(r.corpo?.ok).toBe(true)
    expect(r.corpo?.qtd).toBe(0)
  })

  test('anon não executa o helper nem o aviso', { tag: '@pos-migration' }, async () => {
    for (const fn of ['fn_psgc_depara_herdado', 'fn_psgc_contas_sem_vinculo']) {
      const r = await rpcComo(ANON_KEY, fn, { p_company_id: NADA })
      expect(r.status, fn).toBeGreaterThanOrEqual(400)
      expect(r.corpo?.code, fn).toBe('42501')
    }
  })
})
