// 🚨 Segurança PR A2 (CEO 28/09) · funções que QUALQUER cliente logado podia chamar pela API (rodam como dono e
// pulam a RLS): fn_backup_executar, fn_demo_reset, fn_vault_ler_secret, fn_mudanca_deployar, fn_rateio_calcular_mes...
// Migration 20260928190000: as 533 que o app nunca chama como usuário saem do papel authenticated (serviço e cron
// seguem); as das telas internas PS ganham guarda "equipe PS". Caminho principal: as telas das 6 demos seguem
// carregando com o robô (que chama centenas de funções). As chamadas "negadas" usam funções inofensivas com ids
// inexistentes — no preview (antes da migration) elas ainda rodam e não fazem nada.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const NADA = '00000000-0000-4000-a000-00000000e2e0'

const TELAS = [
  { id: 'b0700000-0000-4000-a000-000000000004', rota: '/dashboard/gestao-empresarial' },
  { id: 'b0700000-0000-4000-a000-000000000001', rota: '/dashboard/oficina/patio' },
  { id: 'b0700000-0000-4000-a000-000000000003', rota: '/dashboard/revenda/patio' },
  { id: 'b0700000-0000-4000-a000-000000000005', rota: '/dashboard/compliance' },
  { id: 'b0700000-0000-4000-a000-000000000002', rota: '/dashboard/pm' },
]

test.describe('Segurança PR A2 · funções internas fora do alcance do cliente logado', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-funcoes-pra2', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('telas principais das demos seguem carregando (sem "permission denied")', { tag: '@pos-migration' }, async ({ page }) => {
    const negados: string[] = []
    page.on('response', async (r) => {
      if (r.url().includes('/rest/v1/rpc/') && (r.status() === 401 || r.status() === 403)) {
        const corpo = await r.text().catch(() => '')
        if (corpo.includes('42501')) negados.push(`${r.status()} ${r.url().split('/rpc/')[1] ?? r.url()}`)
      }
    })
    for (const t of TELAS) {
      await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, t.id)
      await page.goto(t.rota)
      await aguardarConteudo(page)
      await expect(page.getByText(/permission denied/i)).toHaveCount(0)
    }
    expect(negados, 'RPCs negadas por permissão nas telas principais').toEqual([])
  })

  test('cliente logado não executa função interna', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    for (const [fn, args] of [
      ['fn_mudanca_deployar', { p_id: NADA, p_commit_hash: 'e2e', p_commit_url: 'e2e' }],
      ['fn_rateio_calcular_mes', { p_company_id: NADA, p_ano: 1900, p_mes: 1 }],
    ] as const) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args) })
      const b = (await r.json().catch(() => ({}))) as { code?: string }
      expect(r.status, `logado executando ${fn}`).toBeGreaterThanOrEqual(400)
      expect(b.code, `${fn}: negado por permissão`).toBe('42501')
    }
  })
})
