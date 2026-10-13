// #77 / #53 · LTCAT: os RISCOS são do SETOR (valem para todas as funções); EPIs e treinamentos por função.
// Resposta da responsável de SST (15/09, 17/09, 22/09): "os riscos são iguais para todo o setor, porém com EPIs
// diferentes para as funções". Migration 20260927120000 · @pos-migration: veredito no aceitacao-pos-migration.yml.
// RD-82: a RPC é chamada COMO O ROBÔ. Demonstração Indústria (SST); reset da demo no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

test.describe('LTCAT — riscos cadastrados no setor (#77)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-ltcat-riscos-setor-77', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { await rpc('fn_demo_reset', { p_company_id: DEMO_SST }) })

  test('salvar, substituir e ler no painel os riscos do setor, como o robô @pos-migration', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [setor] = await dbSelect<{ id: string }>('prod_setor', `company_id=eq.${DEMO_SST}&nome=eq.Abate&select=id`)
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const chamar = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      if (!r.ok) throw new Error(`rpc ${fn}: ${r.status} ${await r.text()}`)
      return (await r.json()) as T
    }

    const r1 = await chamar<{ ok: boolean; riscos: number }>('fn_ltcat_setor_riscos_salvar', { p_setor_id: setor.id,
      p_riscos: [{ tipo: 'acidente', descricao: 'Corte por faca' }, { tipo: 'fisico', descricao: 'Umidade', grau: '20' }] })
    expect(r1).toEqual({ ok: true, riscos: 2 })
    const r2 = await chamar<{ ok: boolean; riscos: number }>('fn_ltcat_setor_riscos_salvar', { p_setor_id: setor.id,
      p_riscos: [{ tipo: 'acidente', descricao: 'Corte por faca' }] })
    expect(r2, 'salvar de novo SUBSTITUI o conjunto do setor').toEqual({ ok: true, riscos: 1 })
    const ruim = await chamar<{ ok: boolean; erro: string }>('fn_ltcat_setor_riscos_salvar', { p_setor_id: setor.id,
      p_riscos: [{ tipo: 'radioativo', descricao: 'x' }] })
    expect(ruim).toEqual({ ok: false, erro: 'risco_tipo_invalido' })

    const painel = await chamar<{ setores: { nome: string; riscos: { tipo: string; descricao: string }[] }[] }>(
      'fn_ltcat_painel', { p_company_id: DEMO_SST })
    expect(painel.setores.find((s) => s.nome === 'Abate')!.riscos).toEqual([{ tipo: 'acidente', descricao: 'Corte por faca', grau: null }])
  })
})
