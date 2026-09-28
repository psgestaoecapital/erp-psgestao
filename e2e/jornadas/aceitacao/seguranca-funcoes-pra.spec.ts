// 🚨 Segurança PR A (CEO 28/09) · 1.031 funções SECURITY DEFINER executáveis por quem não está logado (rodam como
// dono e pulam a RLS). Migration 20260928180000: anon executa só a lista aprovada (páginas públicas com token +
// as 11 guardas das policies); logado e serviço mantêm o que tinham. O portal do cliente, que nunca funcionou
// (lia a tabela direto como anon), passa a ler por RPC com token.
// As chamadas de "anon negado" usam funções inofensivas com ids inexistentes: no preview (antes da migration) elas
// ainda rodam — e não fazem nada.

import { test, expect } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const anon = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }
const NADA = '00000000-0000-4000-a000-00000000e2e0'
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'

async function rpcAnon(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: anon, body: JSON.stringify(args) })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as { code?: string; ok?: boolean; erro?: string } }
}

test.describe('Segurança PR A · funções sem acesso anônimo', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-funcoes-pra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('portal do cliente e link do contador respondem (link inválido = mensagem clara)', async ({ page, request }) => {
    await page.goto(`/cliente/${DEMO_GE}/token-que-nao-existe-e2e`)
    await expect(page.getByText(/Link inválido ou expirado|Não foi possível carregar/)).toBeVisible({ timeout: 20000 })
    const c = await request.get('/api/contador/token-que-nao-existe-e2e')
    expect(c.status(), 'contador com token inválido').toBe(404)
  })

  test('anon não executa função interna; executa só as da lista; logado segue', { tag: '@pos-migration' }, async () => {
    for (const [fn, args] of [
      ['fn_mudanca_aprovar', { p_id: NADA, p_por: 'e2e' }],
      ['fn_rateio_calcular_mes', { p_company_id: NADA, p_ano: 1900, p_mes: 1 }],
      ['fn_veic_perfil_convite_validar', { p_token: 'token-que-nao-existe-e2e', p_ip: null }],
    ] as const) {
      const r = await rpcAnon(fn, args)
      expect(r.status, `anon executando ${fn}`).toBeGreaterThanOrEqual(400)
      expect(r.body.code, `${fn}: negado por permissão`).toBe('42501')
    }
    // exceções aprovadas seguem abertas (e conferem o token)
    const portal = await rpcAnon('fn_portal_cliente_obter', { p_company_id: DEMO_GE, p_token: 'token-que-nao-existe-e2e' })
    expect(portal.status).toBe(200)
    expect(portal.body.ok).toBe(false)
    const tel = await rpcAnon('fn_registrar_evento_auth', { p_label: 'e2e_pra_anon' })
    expect(tel.status, 'telemetria de login sem sessão').toBe(200)
    // logado mantém o que tinha
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_user_company_ids`, {
      method: 'POST', headers: { ...anon, Authorization: `Bearer ${token}` }, body: '{}',
    })
    expect(r.status, 'logado executando guarda').toBe(200)
  })

  test('portal do cliente abre o relatório pelo link (fechamento de demonstração)', { tag: '@pos-migration' }, async ({ page }) => {
    await page.goto(`/cliente/${DEMO_GE}/demo-portal-ge-2608`)
    await expect(page.getByText('Comércio (GE) - DEMO').first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByText(/Agosto\/2026/).first()).toBeVisible()
    await expect(page.getByText(/Link inválido/)).toHaveCount(0)
  })
})
