// Viagem V2 (fechamento) · migration 20261007140005 · @pos-migration. Na "Agência (P&M) - DEMO" (robô só em demonstração).
// Como o robô (as mesmas RPCs da tela): viagem inexistente não fecha; viagem sem lançamento não fecha; com um lançamento
// fecha UMA vez, grava o evento 'viagem_fechada' (o GE cria o título — a viagem nunca lança financeiro) e fechada não recebe
// lançamento nem fecha de novo. Se a demo não tiver obra/categoria, o teste se declara pulado (não afrouxa nada).
// Limpeza sem apagar: a viagem de teste vai para a lixeira (excluido_em).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbPatch, obterSessionPayload } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

test.describe('Viagem — fechamento', { tag: '@pos-migration' }, () => {
  let token = ''
  async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
    if (!r.ok) throw new Error(`rpc ${fn} falhou: ${r.status} ${await r.text()}`)
    return (await r.json()) as T
  }

  test('fecha uma vez, emite o evento e trava a viagem', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_PM}&select=is_demo`)
    expect(emp?.is_demo, 'só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token

    const inexistente = await rpc<{ ok: boolean }>('fn_viagem_fechar', { p_viagem_id: '00000000-0000-4000-8000-000000000000' })
    expect(inexistente.ok).toBe(false)

    const [obra] = await dbSelect<{ id: string }>('projetos_obras', `company_id=eq.${DEMO_PM}&select=id&limit=1`)
    const [cat] = await dbSelect<{ codigo: string }>('erp_plano_contas', `company_id=eq.${DEMO_PM}&ativo=eq.true&select=codigo&limit=1`)
    test.skip(!obra || !cat, 'a demo da P&M não tem obra/categoria para a viagem de teste')

    const hoje = new Date().toISOString().slice(0, 10)
    const v = await rpc<{ ok: boolean; id: string }>('fn_viagem_salvar', { p_company_id: DEMO_PM, p_id: null, p_dados: { colaborador_nome: 'Robô de aceitação', obra_id: obra.id, periodo_inicio: hoje, periodo_fim: hoje, adiantamento: '100' } })
    expect(v.ok).toBe(true)
    try {
      expect((await rpc<{ ok: boolean }>('fn_viagem_fechar', { p_viagem_id: v.id })).ok, 'sem lançamento não fecha').toBe(false)
      const l = await rpc<{ ok: boolean }>('fn_viagem_lancamento_salvar', { p_viagem_id: v.id, p_id: null, p_dados: { tipo: 'despesa', data: hoje, fornecedor_nome: 'Posto teste', categoria: cat.codigo, forma_pagamento: 'dinheiro', valor: '40', pago_colaborador: true } })
      expect(l.ok).toBe(true)
      const f = await rpc<{ ok: boolean; resumo: { saldo: number } }>('fn_viagem_fechar', { p_viagem_id: v.id })
      expect(f.ok).toBe(true)
      expect(f.resumo.saldo).toBe(60)
      expect((await rpc<{ ok: boolean }>('fn_viagem_fechar', { p_viagem_id: v.id })).ok, 'não fecha duas vezes').toBe(false)
      expect((await rpc<{ ok: boolean }>('fn_viagem_lancamento_salvar', { p_viagem_id: v.id, p_id: null, p_dados: { tipo: 'despesa', data: hoje, fornecedor_nome: 'x', categoria: cat.codigo, forma_pagamento: 'dinheiro', valor: '1' } })).ok, 'fechada não recebe lançamento').toBe(false)
      const ev = await dbSelect<{ tipo: string }>('erp_viagem_evento', `viagem_id=eq.${v.id}&select=tipo`)
      expect(ev.map((e) => e.tipo)).toEqual(['viagem_fechada'])
    } finally {
      await dbPatch('erp_viagem', `id=eq.${v.id}`, { excluido_em: new Date().toISOString() })
    }
  })
})
