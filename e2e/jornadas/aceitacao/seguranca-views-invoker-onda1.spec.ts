// 🚨 Segurança (CEO 05/10) · views da Onda 1 com security_invoker=true. Caminho principal: um usuário logado segue lendo
// as views financeiras/compliance da própria empresa (RLS da base decide), e a auditoria não acusa nenhuma view da Onda 1.
import { test, expect } from '../../support/fixtures'
import { rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const ONDA1 = ['v_contas_pagar_aging', 'v_contas_receber_aging', 'v_titulos_consolidados', 'v_dre_divisional_completo', 'v_epi_dashboard',
  'v_custo_folha_setor', 'v_odonto_debitos_paciente', 'v_veic_patio', 'v_veic_venda', 'v_compliance_matriz_prestadores']

test.describe('Segurança · views Onda 1 com security_invoker', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-views-invoker-onda1', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('usuário logado segue lendo as views da própria empresa (sem erro)', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    for (const v of ['v_contas_pagar_aging', 'v_contas_receber_aging', 'v_titulos_consolidados', 'v_epi_dashboard', 'v_compliance_matriz_prestadores']) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${v}?select=*&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
      expect(r.status, `${v} responde 200 para usuário logado`).toBe(200)
    }
  })

  test('auditoria: nenhuma view da Onda 1 sem security_invoker', { tag: '@pos-migration' }, async () => {
    const sem = await rpc<string[]>('fn_seguranca_views_sem_invoker', {})
    expect(ONDA1.filter(v => sem.includes(v)), 'views da Onda 1 ainda sem security_invoker').toEqual([])
  })
})
