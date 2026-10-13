// Chamado #552 (Pdois, 30/09): "Erro ao gravar um novo lead — não permite avançar". Causa provada no log: o CHECK antigo
// de agency_leads.origem só aceitava 4 origens, mas a tela oferece a lista configurável (WhatsApp, Site, Ligação,
// E-mail, Evento…). Migration 20261001140000 (@pos-migration). Prova na Agência (P&M) - DEMO, como o robô, pela mesma
// RPC da tela: lead com origem "WhatsApp" grava; origem fora da lista da empresa é recusada. Lead de teste fica
// excluído (deleted_at) no fim — RD-30.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbPatch, obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
const criados: string[] = []

async function rpc(fn: string, args: Record<string, unknown>) {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: r.status, corpo: (await r.json().catch(() => null)) as unknown }
}

test.describe('Leads da agência: origem configurável grava (#552)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pdois-lead-origem-552', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of criados) await dbPatch('agency_leads', `id=eq.${id}`, { deleted_at: new Date().toISOString() }).catch(() => {})
  })

  test('lead com origem "WhatsApp" grava; origem fora da lista é recusada', { tag: '@pos-migration' }, async () => {
    // a tela lista as origens antes de abrir o formulário (e semeia a lista padrão na 1ª vez)
    const origens = await rpc('fn_agency_origens_listar', { p_company_id: DEMO_AG })
    expect(origens.status).toBe(200)
    expect((origens.corpo as { chave: string }[]).map((o) => o.chave), 'a lista oferece WhatsApp').toContain('whatsapp')

    const ok = await rpc('fn_agency_lead_criar', { p_campos: { company_id: DEMO_AG, empresa: `E2E lead #552 ${RUN}`, origem: 'whatsapp' } })
    expect(ok.status, JSON.stringify(ok.corpo)).toBe(200)
    const id = ok.corpo as string
    criados.push(id)
    const [lead] = await dbSelect<{ origem: string; company_id: string }>('agency_leads', `id=eq.${id}&select=origem,company_id`)
    expect(lead).toMatchObject({ origem: 'whatsapp', company_id: DEMO_AG })

    const ruim = await rpc('fn_agency_lead_criar', { p_campos: { company_id: DEMO_AG, empresa: `E2E lead ruim ${RUN}`, origem: `inventada_${RUN.toLowerCase()}` } })
    expect(ruim.status, 'origem fora da lista da empresa é recusada').toBeGreaterThanOrEqual(400)
    expect((ruim.corpo as { code?: string }).code).toBe('23514')
  })
})
