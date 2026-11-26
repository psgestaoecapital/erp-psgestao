// Financeiro · Boleto pago com juros baixa COM juros e fica 'pago' — também na conciliação agrupada.
// Migration 20261127161010 · @pos-migration. Code: gilberto-chamados.
//
// REGRA ÚNICA (CEO 25/11): valor_pago = valor recebido = valor − desconto + juros + multa; a soma das baixas
// do título = valor_pago = valor pago pelo banco. Prova, na "Comércio (GE) - DEMO" e como usuário (RPCs reais):
//   1. boleto de R$100 pago com R$4 de juros → baixa automática com juros 4,00 e valor_pago 104,00 → 'pago',
//      soma das baixas = 104,00;
//   2. conciliação agrupada de 2 títulos (R$100 cada) com R$4 a mais no crédito → âncora 'pago' (juros 4,
//      valor_pago 104, baixas 104), o outro título 'pago' (valor_pago 100);
//   3. desfazer a conciliação → os títulos voltam ao estado anterior (juros 0, valor_pago 0, reaberto);
//   4. refazer → âncora volta a 'pago' com valor_pago 104.
// Limpeza no fim: apaga só o que criou (baixas físicas; títulos por soft-delete RD-30; vínculo/movimento/lote).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, rpcComoRobo, pegarTravaDemo, soltarTravaDemo, donoTrava } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const HOJE = new Date().toISOString().slice(0, 10)
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)

type IdRow = { id: string }
type Rec = { id: string; status: string; valor: number; juros: number; valor_pago: number; conciliado: boolean }
type Resp = { sucesso?: boolean; ok?: boolean; erro?: string }

const criado = { receber: [] as string[], lotes: [] as string[], movimentos: [] as string[], contas: [] as string[] }

const recDe = (id: string) =>
  dbSelect<Rec>('erp_receber', `id=eq.${id}&select=id,status,valor,juros,valor_pago,conciliado`).then((r) => r[0])
const somaBaixas = async (id: string): Promise<number> => {
  const bx = await dbSelect<{ valor: number }>('erp_receber_baixa', `receber_id=eq.${id}&deleted_at=is.null&select=valor`)
  return Number(bx.reduce((s, b) => s + Number(b.valor), 0).toFixed(2))
}
let seq = 0
async function criarReceber(valor: number, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await dbInsert<IdRow>('erp_receber', {
    company_id: DEMO_GE, descricao: `E2E boleto-juros ${RUN}-${++seq}`, valor, data_vencimento: HOJE,
    status: 'aberto', cliente_nome: `Cliente E2E ${RUN}`, ...extra,
  })
  criado.receber.push(r.id)
  return r.id
}

test.describe('Financeiro — boleto com juros fica pago (direto e na conciliação) #boleto-juros', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await pegarTravaDemo(donoTrava())
  })

  test.afterAll(async () => {
    const tenta = async (p: () => Promise<unknown>) => { try { await p() } catch (e) { console.warn('[limpeza boleto-juros]', e) } }
    const agora = new Date().toISOString()
    try {
      for (const m of criado.movimentos) await tenta(() => dbDelete('conciliacao_vinculo', `movimento_id=eq.${m}`))
      for (const m of criado.movimentos) await tenta(() => dbDelete('conciliacao_movimento', `id=eq.${m}`))
      for (const l of criado.lotes) await tenta(() => dbDelete('conciliacao_lote', `id=eq.${l}`))
      if (criado.receber.length) {
        await tenta(() => dbDelete('erp_receber_baixa', `receber_id=in.(${criado.receber.join(',')})`))
        // solta o FK para a conta (erp_receber_conta_bancaria_id_fkey) ANTES de apagar a conta, senão o delete da conta falha
        await tenta(() => dbPatch('erp_receber', `id=in.(${criado.receber.join(',')})`, { status: 'cancelado', deleted_at: agora, conta_bancaria_id: null, movimento_banco_id: null }))
      }
      for (const c of criado.contas) await tenta(() => dbDelete('erp_banco_contas', `id=eq.${c}`))
    } finally {
      await soltarTravaDemo(donoTrava())
    }
  })

  test('boleto de R$100 pago com R$4 de juros → baixa com juros 4,00 e valor_pago 104,00, status pago', { tag: '@pos-migration' }, async () => {
    const nn = `E2E${RUN}${seq + 1}`.slice(0, 20)
    const rec = await criarReceber(100, { boleto_banco_codigo: '748', boleto_nosso_numero: nn, boleto_status: 'registrado', boleto_emitido_em: new Date().toISOString() })
    const r = await rpcComoRobo<Resp>('fn_boleto_liquidar_banco', {
      p_company_id: DEMO_GE, p_banco_codigo: '748', p_nosso_numero: nn, p_data_pagamento: HOJE, p_valor_pago: 104.00,
    })
    expect(r.corpo?.sucesso, `liquidar com juros (resp: ${r.texto})`).toBe(true)
    const t = await recDe(rec)
    expect(Number(t.juros), 'a diferença de R$4 vira juros').toBe(4)
    expect(Number(t.valor_pago), 'valor_pago = valor pago pelo banco').toBe(104)
    expect(t.status, 'boleto pago com juros fica PAGO').toBe('pago')
    expect(await somaBaixas(rec), 'soma das baixas = valor pago pelo banco').toBe(104)
  })

  test('conciliação agrupada com R$4 a mais → âncora pago; desfazer volta ao estado anterior; refazer fica pago', { tag: '@pos-migration' }, async () => {
    const conta = await dbInsert<IdRow>('erp_banco_contas', { company_id: DEMO_GE, nome: `Conta E2E ${RUN}` })
    criado.contas.push(conta.id)
    const lote = await dbInsert<IdRow>('conciliacao_lote', { company_id: DEMO_GE, conta_bancaria_id: conta.id, tipo: 'bancario', origem: 'ofx', nome: `Boleto juros conciliação ${RUN}` })
    criado.lotes.push(lote.id)
    const mov = await dbInsert<IdRow>('conciliacao_movimento', {
      company_id: DEMO_GE, lote_id: lote.id, valor: 204.00, data_transacao: HOJE, descricao_normalizada: `liq ${RUN}`, status: 'pendente',
    })
    criado.movimentos.push(mov.id)
    const t1 = await criarReceber(100) // âncora
    const t2 = await criarReceber(100)
    await dbInsert('conciliacao_vinculo', { movimento_id: mov.id, company_id: DEMO_GE, lancamento_tabela: 'erp_receber', lancamento_id: t1, valor_vinculado: 100 })
    await dbInsert('conciliacao_vinculo', { movimento_id: mov.id, company_id: DEMO_GE, lancamento_tabela: 'erp_receber', lancamento_id: t2, valor_vinculado: 100 })

    // fechar: crédito 204 = 200 (2 títulos) + 4 de juros, lançados no âncora t1
    const f = await rpcComoRobo<Resp>('fn_conciliacao_fechar_agrupado', {
      p_movimento_id: mov.id, p_operador_id: null, p_tolerancia: 0.05, p_juros: 4, p_multa: 0, p_desconto: 0, p_ajuste_lancamento_id: t1, p_observacao: 'E2E',
    })
    expect(f.corpo?.ok, `fechar agrupado (resp: ${f.texto})`).toBe(true)
    let a = await recDe(t1)
    expect(Number(a.juros), 'âncora: diferença vira juros 4').toBe(4)
    expect(Number(a.valor_pago), 'âncora: valor_pago = 104 (valor recebido)').toBe(104)
    expect(a.status, 'âncora fica PAGO').toBe('pago')
    expect(await somaBaixas(t1), 'âncora: soma das baixas = 104').toBe(104)
    const b = await recDe(t2)
    expect(Number(b.valor_pago), 'o outro título: valor_pago 100').toBe(100)
    expect(b.status, 'o outro título fica PAGO').toBe('pago')

    // desfazer → volta ao estado anterior (juros 0, valor_pago 0, reaberto)
    const d = await rpcComoRobo<Resp>('fn_conciliacao_desvincular_movimento', { p_movimento_id: mov.id, p_operador_id: null })
    expect(d.corpo?.sucesso, `desvincular (resp: ${d.texto})`).toBe(true)
    a = await recDe(t1)
    expect(Number(a.juros), 'desfazer: juros volta a 0').toBe(0)
    expect(Number(a.valor_pago), 'desfazer: valor_pago volta a 0').toBe(0)
    expect(a.conciliado, 'desfazer: deixa de estar conciliado').toBe(false)
    expect(['aberto', 'vencido']).toContain(a.status)

    // refazer → âncora volta a pago 104
    await dbPatch('conciliacao_movimento', `id=eq.${mov.id}`, { status: 'pendente', lancamento_tabela: null, lancamento_id: null })
    await dbInsert('conciliacao_vinculo', { movimento_id: mov.id, company_id: DEMO_GE, lancamento_tabela: 'erp_receber', lancamento_id: t1, valor_vinculado: 100 })
    await dbInsert('conciliacao_vinculo', { movimento_id: mov.id, company_id: DEMO_GE, lancamento_tabela: 'erp_receber', lancamento_id: t2, valor_vinculado: 100 })
    const f2 = await rpcComoRobo<Resp>('fn_conciliacao_fechar_agrupado', {
      p_movimento_id: mov.id, p_operador_id: null, p_tolerancia: 0.05, p_juros: 4, p_multa: 0, p_desconto: 0, p_ajuste_lancamento_id: t1, p_observacao: 'E2E refazer',
    })
    expect(f2.corpo?.ok, `refazer (resp: ${f2.texto})`).toBe(true)
    a = await recDe(t1)
    expect(Number(a.valor_pago), 'refazer: valor_pago volta a 104').toBe(104)
    expect(a.status, 'refazer: âncora volta a PAGO').toBe('pago')
  })
})
