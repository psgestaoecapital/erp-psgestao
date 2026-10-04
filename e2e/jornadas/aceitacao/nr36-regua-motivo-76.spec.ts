// #76 (Frioeste · CEO 03/10) · "precisa estar especificado o porquê do desvio indicando a régua estabelecida de mínimo e
// máximo". fn_nr36_pausas_regua devolve a régua da empresa e a duração em SEGUNDOS de cada pausa curta/longa — o número
// que decide (a tela mostrava minutos arredondados: 19:56 aparecia como "20 min").
// Migration 20261004090000 · @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
// RD-82: chamada COMO O ROBÔ (a mesma da tela). Demonstração Indústria (SST), só leitura.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'
import { motivoRegua, reguaDe } from '../../../src/lib/ponto/reguaPausa'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

type Resp = { ok: boolean; erro?: string; regua?: Record<string, unknown>; pausas?: { seg: number; classe: string; de: string; ate: string }[] }

test.describe('Régua das pausas térmicas: motivo do desvio com segundos (#76)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nr36-regua-76', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  async function chamar(token: string | null, args: Record<string, unknown>) {
    return fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_nr36_pausas_regua`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token || ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
  }

  test('régua da empresa + segundos de cada desvio; período limitado; sem anon @pos-migration', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token

    const fim = new Date(); const ini = new Date(fim.getTime() - 90 * 86400000)
    const d = (x: Date) => x.toISOString().slice(0, 10)
    const resp = await chamar(token, { p_company_id: DEMO_SST, p_ini: d(ini), p_fim: d(fim) })
    expect(resp.ok).toBe(true)
    const r = (await resp.json()) as Resp
    expect(r.ok).toBe(true)
    const regua = reguaDe(r.regua)
    expect(regua.pausa_min).toBeGreaterThan(0)
    for (const p of r.pausas || []) {
      expect(['pausa_insuficiente', 'pausa_excesso']).toContain(p.classe)
      expect(typeof p.seg).toBe('number')
      expect(motivoRegua({ seg: p.seg, classe: p.classe }, regua), 'todo desvio tem o motivo pela régua').toMatch(/^(abaixo do mínimo|acima do máximo): \d+:\d{2} (<|≥) \d+:\d{2}$/)
    }

    const longo = await chamar(token, { p_company_id: DEMO_SST, p_ini: '2026-01-01', p_fim: '2026-12-31' })
    expect(((await longo.json()) as Resp).erro, 'período acima de 3 meses é recusado').toBe('periodo_invalido')

    const anon = await chamar(null, { p_company_id: DEMO_SST, p_ini: d(ini), p_fim: d(fim) })
    expect(anon.ok, 'sem login não chama').toBe(false)
  })
})
