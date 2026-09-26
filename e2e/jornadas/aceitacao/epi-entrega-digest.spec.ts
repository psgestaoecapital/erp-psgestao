// Correção · a entrega de EPI falhava para qualquer empresa ("function digest(text, unknown) does not exist"):
// o trigger de hash da movimentação chamava digest() sem schema dentro de fn_epi_registrar_entrega (search_path public).
// Migration 20260926350000 · @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
// RD-82: a RPC é chamada COMO O ROBÔ (a mesma da tela). Demonstração Indústria (SST); reset da demo no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

test.describe('Correção — entrega de EPI grava a movimentação com hash', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-epi-entrega-digest', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { await rpc('fn_demo_reset', { p_company_id: DEMO_SST }) })

  test('fn_epi_registrar_entrega como o robô registra a entrega (sem erro de digest) @pos-migration', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [func] = await dbSelect<{ id: string }>('compliance_funcionarios',
      `company_id=eq.${DEMO_SST}&nome_completo=eq.${encodeURIComponent('Nelson Pires Demo')}&select=id`)
    const [epi] = await dbSelect<{ id: string }>('epi_catalogo',
      `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent('Óculos de proteção incolor')}&select=id`)
    expect(func?.id && epi?.id, 'funcionário e EPI da demo').toBeTruthy()

    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_epi_registrar_entrega`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: DEMO_SST, p_funcionario_id: func.id, p_catalogo_id: epi.id,
        p_tipo_movimento: 'entrega_inicial', p_quantidade: 1, p_motivo: 'aceitação digest', p_observacoes: null }),
    })
    const corpo = await resp.text()
    expect(resp.ok, `a RPC não pode falhar (antes: digest não existe) — ${corpo}`).toBe(true)
    const r = JSON.parse(corpo) as { sucesso: boolean; movimentacao_id: string }
    expect(r.sucesso).toBe(true)

    const [mov] = await dbSelect<{ hash_integridade: string | null; tipo_movimento: string }>('epi_movimentacao',
      `id=eq.${r.movimentacao_id}&select=hash_integridade,tipo_movimento`)
    expect(mov?.tipo_movimento).toBe('entrega_inicial')
    expect(mov?.hash_integridade, 'hash de integridade NR-6 gravado').toMatch(/^[0-9a-f]{64}$/)
  })
})
