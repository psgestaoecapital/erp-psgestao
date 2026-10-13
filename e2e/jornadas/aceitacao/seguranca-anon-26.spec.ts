// 🚨 Segurança (CEO 30/09 · alerta do Supabase de 27/09) · funções que o anon executa voltam para as 26 aprovadas
// (scripts/anon-funcoes-aprovadas.ts). Migration 20260930140000: fn_acessos_pode_gerir sai do anon; 5 funções
// SECURITY INVOKER que nasceram com EXECUTE para PUBLIC (fn_brl, fn_nr36_duracao_seg e 3 de gatilho) fecham; e a
// causa — o privilégio padrão que dava EXECUTE a PUBLIC em toda função nova — é corrigida.
// Caminho principal: as exceções aprovadas seguem abertas; logado segue executando fn_acessos_pode_gerir.

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
  return { status: r.status, corpo: (await r.json().catch(() => null)) as { code?: string; ok?: boolean } | null }
}

test.describe('Segurança · anon executa só as 26 funções aprovadas', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-anon-26', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('exceções aprovadas seguem abertas ao anon; logado segue gerindo acessos', async () => {
    const convite = await rpcComo(ANON_KEY, 'fn_convite_ler', { p_code: 'e2e-convite-inexistente-anon26' })
    expect(convite.status, 'convite (página pública) responde sem login').toBe(200)
    expect(convite.corpo?.ok, 'convite inexistente: ok=false').toBe(false)
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const logado = await rpcComo(token, 'fn_acessos_pode_gerir', { p_company_id: NADA })
    expect(logado.status, 'logado executando fn_acessos_pode_gerir').toBe(200)
  })

  test('anon não executa fn_acessos_pode_gerir nem as funções fora da lista', { tag: '@pos-migration' }, async () => {
    for (const [fn, args] of [
      ['fn_acessos_pode_gerir', { p_company_id: NADA }],
      ['fn_brl', { p: 1 }],
    ] as const) {
      const r = await rpcComo(ANON_KEY, fn, args)
      expect(r.status, `anon executando ${fn}`).toBeGreaterThanOrEqual(400)
      expect(r.corpo?.code, `${fn}: negado por permissão`).toBe('42501')
    }
  })
})
