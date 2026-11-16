// GE · /dashboard/financeiro/fluxo-caixa — REALIZADO vem do LEDGER de baixa, não de data_pagamento.
// Migration 20261118180044 · @pos-migration. Code: code-desenvolvedor-3.
//
// Rede de regressão do bug de núcleo financeiro (RD-38): fn_fluxo_caixa_diario calculava o realizado chaveando
// por erp_receber.data_pagamento / erp_pagar.data_pagamento. Quando a baixa não carimba data_pagamento no título
// (bulk/baixa parcial multi-data), o realizado zerava apesar do dinheiro ter entrado/saído (datado no ledger).
//
// O spec REPRODUZ exatamente o estado do bug na DEMO GE: título 'pago' + baixa DATADA no ledger, porém com
// data_pagamento = NULL. Confere que o realizado do dia passa a incluir o valor da baixa (fonte = ledger).
// No código ANTIGO o delta seria 0 (data_pagamento nulo); no novo é = valor da baixa. Limpa o que cria.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, rpcComoRobo, pegarTravaDemo, soltarTravaDemo, donoTrava } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
// data de recebimento/pagamento 3 dias atrás (sempre passado em relação ao run → "realizado")
const X = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)

type IdRow = { id: string }
type Fluxo = { total_recebimentos?: number; total_pagamentos?: number }
type Rec = { id: string; status: string; data_pagamento: string | null; valor_pago: number }

const criado = { receber: [] as string[], pagar: [] as string[], recBaixa: [] as string[], pagBaixa: [] as string[] }

const realizado = async (campo: 'total_recebimentos' | 'total_pagamentos'): Promise<number> => {
  const r = await rpcComoRobo<Fluxo>('fn_fluxo_caixa_diario', { p_company_id: DEMO_GE, p_data_inicio: X, p_data_fim: X })
  expect(r.corpo, `fn_fluxo_caixa_diario deve responder (resp: ${r.texto})`).not.toBeNull()
  return Number(r.corpo?.[campo] ?? 0)
}

test.describe('GE — fluxo de caixa: realizado pelo ledger de baixa #fluxo-caixa', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await pegarTravaDemo(donoTrava())
  })

  test.afterAll(async () => {
    try {
      for (const id of criado.recBaixa) await dbDelete('erp_receber_baixa', `id=eq.${id}`)
      for (const id of criado.pagBaixa) await dbDelete('erp_pagar_baixa', `id=eq.${id}`)
      for (const id of criado.receber) await dbDelete('erp_receber', `id=eq.${id}`)
      for (const id of criado.pagar) await dbDelete('erp_pagar', `id=eq.${id}`)
    } finally {
      await soltarTravaDemo(donoTrava())
    }
  })

  test('recebimento: baixa datada no ledger entra no realizado mesmo com data_pagamento NULL', { tag: '@pos-migration' }, async () => {
    const Y = 13572.46
    const antes = await realizado('total_recebimentos')

    const rec = await dbInsert<IdRow>('erp_receber', {
      company_id: DEMO_GE, descricao: `E2E fluxo receber ${RUN}`, valor: Y, data_vencimento: X,
      status: 'pendente', cliente_nome: `Cliente E2E ${RUN}`,
    })
    criado.receber.push(rec.id)
    const bx = await dbInsert<IdRow>('erp_receber_baixa', {
      receber_id: rec.id, company_id: DEMO_GE, valor: Y, data: X, origem: 'e2e-fluxo',
    })
    criado.recBaixa.push(bx.id)
    // reproduz o estado do bug: baixa datada no ledger, MAS o título sem data_pagamento (pelo path antigo,
    // chaveado por data_pagamento + status IN ('pago','recebido'), este recebimento somaria 0).
    await dbPatch('erp_receber', `id=eq.${rec.id}`, { data_pagamento: null })
    const [parent] = await dbSelect<Rec>('erp_receber', `id=eq.${rec.id}&select=id,status,data_pagamento,valor_pago`)
    expect(parent.data_pagamento, 'estado do bug: data_pagamento deve estar nulo').toBeNull()

    const depois = await realizado('total_recebimentos')
    expect(Number((depois - antes).toFixed(2)), 'o realizado do dia soma a baixa do ledger (antes zerava)').toBe(Y)
  })

  test('pagamento: baixa datada no ledger entra no realizado mesmo com data_pagamento NULL', { tag: '@pos-migration' }, async () => {
    const Y = 24681.35
    const antes = await realizado('total_pagamentos')

    const pag = await dbInsert<IdRow>('erp_pagar', {
      company_id: DEMO_GE, descricao: `E2E fluxo pagar ${RUN}`, valor: Y, data_vencimento: X, status: 'pendente',
    })
    criado.pagar.push(pag.id)
    const bx = await dbInsert<IdRow>('erp_pagar_baixa', {
      pagar_id: pag.id, company_id: DEMO_GE, valor: Y, data: X, origem: 'e2e-fluxo',
    })
    criado.pagBaixa.push(bx.id)
    await dbPatch('erp_pagar', `id=eq.${pag.id}`, { data_pagamento: null })
    const [parent] = await dbSelect<Rec>('erp_pagar', `id=eq.${pag.id}&select=id,status,data_pagamento,valor_pago`)
    expect(parent.data_pagamento, 'estado do bug: data_pagamento deve estar nulo').toBeNull()

    const depois = await realizado('total_pagamentos')
    expect(Number((depois - antes).toFixed(2)), 'o realizado do dia soma a baixa do ledger (antes zerava)').toBe(Y)
  })
})
