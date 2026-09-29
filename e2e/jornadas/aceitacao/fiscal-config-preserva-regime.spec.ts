// Salvar a Configuração Fiscal não apaga o regime da empresa (CEO 29/09 · FC Pisos é LUCRO REAL). Antes, a tela
// Configurações › Fiscal gravava "regime_normal" por cima de lucro_real (audit_log da FC: 08/09 e 23/09).
// Migration 20260929070000 (@pos-migration). Demonstração Indústria (SST): o regime, a IM e a config fiscal de teste
// são restaurados/removidos no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbPatch, dbDelete, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO = 'b0700000-0000-4000-a000-000000000005'
let original: { regime_tributario: string | null; inscricao_municipal: string | null } = { regime_tributario: null, inscricao_municipal: null }
let tinhaConfig = true

async function salvarConfig(regime: string) {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_fiscal_salvar_config`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_company_id: DEMO, p_provider: 'focusnfe', p_ambiente: 'homologacao', p_inscricao_municipal: 'E2E-123', p_regime: regime, p_opcao_sn: regime === 'regime_normal' ? 1 : 3 }),
  })
  expect(r.status, 'fn_fiscal_salvar_config responde').toBe(200)
}
const regimeAtual = async () => (await dbSelect<{ regime_tributario: string | null }>('companies', `id=eq.${DEMO}&select=regime_tributario`))[0]?.regime_tributario

test.describe('Configuração Fiscal preserva o regime da empresa (Lucro Real / Presumido)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean; regime_tributario: string | null; inscricao_municipal: string | null }>('companies',
      `id=eq.${DEMO}&select=is_demo,regime_tributario,inscricao_municipal`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    original = { regime_tributario: emp.regime_tributario, inscricao_municipal: emp.inscricao_municipal }
    tinhaConfig = (await dbSelect('erp_fiscal_provider_config', `company_id=eq.${DEMO}&provider=eq.focusnfe&select=id`)).length > 0
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-fiscal-config-preserva-regime', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    await dbPatch('companies', `id=eq.${DEMO}`, original).catch(() => {})
    if (!tinhaConfig) await dbDelete('erp_fiscal_provider_config', `company_id=eq.${DEMO}&provider=eq.focusnfe`).catch(() => {})
  })

  test('lucro_real e lucro_presumido sobrevivem ao salvar a config como regime normal; Simples continua atualizando', { tag: '@pos-migration' }, async () => {
    await dbPatch('companies', `id=eq.${DEMO}`, { regime_tributario: 'lucro_real' })
    await salvarConfig('regime_normal')
    expect(await regimeAtual(), 'Lucro Real não vira "regime_normal"').toBe('lucro_real')

    await dbPatch('companies', `id=eq.${DEMO}`, { regime_tributario: 'lucro_presumido' })
    await salvarConfig('regime_normal')
    expect(await regimeAtual(), 'Lucro Presumido não vira "regime_normal"').toBe('lucro_presumido')

    await salvarConfig('simples_nacional')
    expect(await regimeAtual(), 'Simples Nacional continua atualizando a empresa').toBe('simples_nacional')
  })
})
