// Revenda · acerto pós-venda (CEO 27/09: CORRIGIR). Antes: +R$ 1.000 de custo lançado DEPOIS da venda derrubava o
// lucro real em ~R$ 2.030 (o custo contava 2x), e o retorno do banco entrava no lucro com o título EM ABERTO (e 2x
// depois de pago). Agora: o custo pós-venda conta uma vez só (já está no custo real) e o retorno entra quando o banco
// paga. Migration 20260927160000 · @pos-migration. Como o robô (RD-82). Demonstração Revenda; tudo desfeito no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
type Acerto = { ok: boolean; previsto: { custo_real_total: number }; realizado: { lucro_real: number; custos_pos_venda: number; em_aberto_banco: number } }

test.describe('Revenda — acerto sem contar 2x custo pós-venda e retorno do banco', () => {
  let custoId = ''; let recebId = ''; let vendaId = ''; let retornoOriginal: number | null = null

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-revenda-acerto-2x', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (custoId) await dbPatch('veic_custo', `id=eq.${custoId}`, { deleted_at: new Date().toISOString() })
    if (recebId) await dbDelete('veic_venda_recebimento', `id=eq.${recebId}`).catch(() => {})
    if (vendaId) await dbPatch('veic_venda', `id=eq.${vendaId}`, { retorno_banco: retornoOriginal })
  })

  test('custo pós-venda conta uma vez; retorno em aberto não entra no lucro @pos-migration', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_REVENDA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [venda] = await dbSelect<{ id: string; veiculo_id: string; data_venda: string; retorno_banco: number | null }>('veic_venda',
      `company_id=eq.${DEMO_REVENDA}&deleted_at=is.null&situacao=neq.cancelada&select=id,veiculo_id,data_venda,retorno_banco&order=data_venda.desc&limit=1`)
    vendaId = venda.id; retornoOriginal = venda.retorno_banco
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const acerto = async (): Promise<Acerto> => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_veic_venda_acerto`, { method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_venda_id: venda.id }) })
      if (!r.ok) throw new Error(`acerto: ${r.status} ${await r.text()}`)
      return (await r.json()) as Acerto
    }

    const a0 = await acerto(); expect(a0.ok).toBe(true)
    const depois = new Date(new Date(venda.data_venda).getTime() + 5 * 86400000).toISOString().slice(0, 10)
    custoId = (await dbInsert<{ id: string }>('veic_custo', { company_id: DEMO_REVENDA, veiculo_id: venda.veiculo_id, categoria: 'outro',
      descricao: 'aceitação acerto pós-venda', valor: 1000, data_custo: depois })).id
    const a1 = await acerto()
    const dLucro = Number(a1.realizado.lucro_real) - Number(a0.realizado.lucro_real)
    const dCusto = Number(a1.previsto.custo_real_total) - Number(a0.previsto.custo_real_total)
    expect(dCusto, 'o custo real subiu pelo custo lançado').toBeGreaterThanOrEqual(1000)
    expect(dLucro, 'o lucro cai UMA vez o que o custo subiu (antes caía 2x)').toBeCloseTo(-dCusto, 2)

    // retorno do banco registrado e ainda NÃO pago: não entra no lucro realizado (antes entrava na hora)
    await dbPatch('veic_venda', `id=eq.${venda.id}`, { retorno_banco: 2000 })
    recebId = (await dbInsert<{ id: string }>('veic_venda_recebimento', { company_id: DEMO_REVENDA, venda_id: venda.id,
      tipo: 'retorno_banco', devedor: 'banco', valor: 2000 })).id
    const a2 = await acerto()
    expect(Number(a2.realizado.lucro_real), 'retorno em aberto não soma no lucro').toBeCloseTo(Number(a1.realizado.lucro_real), 2)
    expect(Number(a2.realizado.em_aberto_banco) - Number(a1.realizado.em_aberto_banco), 'aparece como em aberto do banco').toBeCloseTo(2000, 2)
  })
})
