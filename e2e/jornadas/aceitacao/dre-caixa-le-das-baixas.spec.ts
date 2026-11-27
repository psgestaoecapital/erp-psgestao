// GE · /dashboard/financeiro/dre-consolidado — regime CAIXA do DRE vem das BAIXAS, não do título cheio.
// Migration 20261129130040 · @pos-migration. Code: code-desenvolvedor-3.
//
// Rede de regressão do bug de núcleo (RD-38, provado na DEMO GE): fn_psgc_recalcular_dre_mes nos blocos
// etl_receber_caixa / etl_pagar_caixa usava o valor CHEIO do título (r.valor / p.valor) filtrado por
// data_pagamento do cabeçalho. Dois defeitos: (1) título PARCIAL lançava o valor cheio no caixa
// (super-reporta o realizado); (2) título com baixa real mas data_pagamento ≠ mês da baixa (o núcleo
// fn_trg_status_lancamento carimba data_pagamento = CURRENT_DATE ao quitar) caía no mês errado ou sumia.
//
// O fix faz o caixa ler das BAIXAS (erp_receber_baixa / erp_pagar_baixa): valor = b.valor, competência = b.data.
// Este spec prova, num mês HISTÓRICO VAZIO (2020-01) da DEMO para isolar (RD-41), que recalcular aquele mês dá:
//   - etl_receber_caixa = valor da BAIXA (464), nunca o título cheio (1160), apesar de data_pagamento = HOJE (≠ 2020-01);
//   - etl_pagar_caixa  = valor da BAIXA (400), nunca o título cheio (1000).
// Delta (depois − antes) isola o run de qualquer resíduo. Limpeza: baixa por DELETE físico (sem trava RD-30),
// título por SOFT-DELETE (trg_bloqueia_delete_fisico), e recalcula o mês para não deixar resíduo no psgc_dre.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, rpcComoRobo, pegarTravaDemo, soltarTravaDemo, donoTrava } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const ANO = 2020
const MES = 1
const DIA_BAIXA = '2020-01-15' // competência da baixa (mês vazio na DEMO → isola o run)
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)

type IdRow = { id: string }
type Parent = { id: string; status: string; data_pagamento: string | null; valor_pago: number }
type DreRow = { valor: number }

const criado = { receber: [] as string[], pagar: [] as string[], recBaixa: [] as string[], pagBaixa: [] as string[] }

// soma do regime caixa de um `source` no mês 2020-01, depois de recalcular (idempotente)
const caixaDoMes = async (source: 'etl_receber_caixa' | 'etl_pagar_caixa'): Promise<number> => {
  await rpcComoRobo('fn_psgc_recalcular_dre_mes', { p_company_id: DEMO_GE, p_ano: ANO, p_mes: MES })
  const rows = await dbSelect<DreRow>(
    'psgc_dre',
    `company_id=eq.${DEMO_GE}&ano=eq.${ANO}&mes=eq.${MES}&source=eq.${source}&select=valor`,
  )
  return rows.reduce((s, r) => s + Number(r.valor), 0)
}

test.describe('GE — DRE regime caixa lê das baixas #dre-caixa', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await pegarTravaDemo(donoTrava())
  })

  test.afterAll(async () => {
    try {
      for (const id of criado.recBaixa) await dbDelete('erp_receber_baixa', `id=eq.${id}`)
      for (const id of criado.pagBaixa) await dbDelete('erp_pagar_baixa', `id=eq.${id}`)
      const agora = new Date().toISOString()
      for (const id of criado.receber) await dbPatch('erp_receber', `id=eq.${id}&deleted_at=is.null`, { deleted_at: agora })
      for (const id of criado.pagar) await dbPatch('erp_pagar', `id=eq.${id}&deleted_at=is.null`, { deleted_at: agora })
      // recalcula 2020-01 já sem os títulos do run → psgc_dre do mês volta a ficar vazio (sem resíduo).
      await rpcComoRobo('fn_psgc_recalcular_dre_mes', { p_company_id: DEMO_GE, p_ano: ANO, p_mes: MES })
    } finally {
      await soltarTravaDemo(donoTrava())
    }
  })

  test('receber caixa: título parcial soma a BAIXA (464), nunca o título cheio (1160)', { tag: '@pos-migration' }, async () => {
    const antes = await caixaDoMes('etl_receber_caixa')

    const rec = await dbInsert<IdRow>('erp_receber', {
      company_id: DEMO_GE, descricao: `E2E dre caixa receber ${RUN}`, valor: 1160,
      data_vencimento: DIA_BAIXA, data_competencia: DIA_BAIXA, status: 'pendente',
      cliente_nome: `Cliente E2E ${RUN}`, categoria: 'Receita de vendas',
    })
    criado.receber.push(rec.id)
    const bx = await dbInsert<IdRow>('erp_receber_baixa', {
      receber_id: rec.id, company_id: DEMO_GE, valor: 464, data: DIA_BAIXA, forma: 'PIX', origem: 'e2e-dre-caixa',
    })
    criado.recBaixa.push(bx.id)

    // precondição do bug: baixa parcial (464 < 1160) e o núcleo carimba data_pagamento = HOJE (≠ 2020-01).
    const [parent] = await dbSelect<Parent>('erp_receber', `id=eq.${rec.id}&select=id,status,data_pagamento,valor_pago`)
    expect(parent.status, 'baixa parcial → status parcial').toBe('parcial')
    expect(Number(parent.valor_pago), 'valor_pago = valor da baixa (464)').toBe(464)
    expect(parent.data_pagamento?.slice(0, 7), 'data_pagamento (hoje) ≠ mês da baixa (2020-01)').not.toBe('2020-01')

    const depois = await caixaDoMes('etl_receber_caixa')
    expect(depois - antes, 'o caixa do mês soma a BAIXA (464), não o título cheio (1160)').toBeCloseTo(464, 2)
  })

  test('pagar caixa: título parcial soma a BAIXA (400), nunca o título cheio (1000)', { tag: '@pos-migration' }, async () => {
    const antes = await caixaDoMes('etl_pagar_caixa')

    const pag = await dbInsert<IdRow>('erp_pagar', {
      company_id: DEMO_GE, descricao: `E2E dre caixa pagar ${RUN}`, valor: 1000,
      data_vencimento: DIA_BAIXA, data_competencia: DIA_BAIXA, status: 'pendente', categoria: 'Despesa operacional',
    })
    criado.pagar.push(pag.id)
    const bx = await dbInsert<IdRow>('erp_pagar_baixa', {
      pagar_id: pag.id, company_id: DEMO_GE, valor: 400, data: DIA_BAIXA, forma: 'pix', origem: 'e2e-dre-caixa',
    })
    criado.pagBaixa.push(bx.id)

    const [parent] = await dbSelect<Parent>('erp_pagar', `id=eq.${pag.id}&select=id,status,data_pagamento,valor_pago`)
    expect(parent.status, 'baixa parcial → status parcial').toBe('parcial')
    expect(Number(parent.valor_pago), 'valor_pago = valor da baixa (400)').toBe(400)
    expect(parent.data_pagamento?.slice(0, 7), 'data_pagamento (hoje) ≠ mês da baixa (2020-01)').not.toBe('2020-01')

    const depois = await caixaDoMes('etl_pagar_caixa')
    expect(depois - antes, 'o caixa do mês soma a BAIXA (400), não o título cheio (1000)').toBeCloseTo(400, 2)
  })
})
