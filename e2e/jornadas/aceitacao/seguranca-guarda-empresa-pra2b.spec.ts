// 🚨 Segurança PR A2b parte 1 (CEO 28/09) · 23 funções que recebem a empresa por parâmetro e rodam como dono
// (pulam a RLS): qualquer cliente logado podia passar o id de OUTRA empresa e apagar/gravar lá (ex.:
// fn_balanco_linha_excluir, fn_dre_ordem_personalizada_reset, fn_alertas_gerar_automaticos).
// Migration 20260928200000: cada uma ganha a guarda "a empresa tem de ser do usuário" (sem usuário = serviço/cron
// passa). Caminho principal: com a empresa da demo a função segue respondendo (id inexistente → nada apagado).
// Negado: com empresa que não é do usuário → 42501. O robô é PS_ADMIN mas não "adm" (is_admin() = false), então a
// guarda vale para ele. No preview (antes da migration) as chamadas rodam e não fazem nada (ids inexistentes).

import { test, expect } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const OUTRA = '00000000-0000-4000-a000-0000000a2b01'
const NADA = '00000000-0000-4000-a000-0000000a2b02'

async function chamar(fn: string, args: Record<string, unknown>) {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: r.status, corpo: (await r.json().catch(() => ({}))) as { code?: string; ok?: boolean } }
}

test.describe('Segurança PR A2b · função com empresa exige que a empresa seja do usuário', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-guarda-empresa-pra2b', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('empresa do usuário: a função segue respondendo', async () => {
    const r = await chamar('fn_balanco_linha_excluir', { p_company_id: DEMO_GE, p_id: NADA })
    expect(r.status, 'balanço da demo GE').toBe(200)
    expect(r.corpo.ok, 'id inexistente: nada apagado').toBe(false)
  })

  test('empresa de outro: negado', { tag: '@pos-migration' }, async () => {
    for (const [fn, args] of [
      ['fn_balanco_linha_excluir', { p_company_id: OUTRA, p_id: NADA }],
      ['fn_dre_ordem_personalizada_reset', { p_company_id: OUTRA }],
    ] as const) {
      const r = await chamar(fn, args)
      expect(r.status, `${fn} em empresa alheia`).toBeGreaterThanOrEqual(400)
      expect(r.corpo.code, `${fn}: negado por permissão`).toBe('42501')
    }
  })
})
