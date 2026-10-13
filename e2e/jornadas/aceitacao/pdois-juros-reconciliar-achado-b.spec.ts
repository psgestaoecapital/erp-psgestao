// Regressão do ACHADO B (Pdois/CASART, 18/09): juros lançados duas vezes ao reconciliar.
// Sequência real do audit_log: 1ª conciliação com ajuste (juros 0→10, pago 3.090) → desconciliar → reconciliar pelo
// "Vincular vários" com acréscimo → juros 10→20, título PARCIAL com R$ 10 em aberto que não existem.
// Causa provada (RD-38): o desconciliar antigo deixava um valor_pago-fantasma = os juros (3.090 − 3.080); a reconciliação
// via vínculo media o saldo (3.070) e o acréscimo virava 20, gravado por cima dos 10. O #1833 (26/09) já faz o
// desconciliar recompor pelas baixas (pago volta a 0). Este teste trava a sequência inteira para não voltar.
// Sem tag: não depende de migration nova. Demonstração Comércio (GE); RPCs COMO O ROBÔ (as mesmas da tela).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Titulo = { juros: number; valor_pago: number | null; status: string }

test.describe('Regressão achado B — reconciliar com acréscimo não dobra os juros', () => {
  let token = ''
  let lote = ''
  let titulo = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('regressao-achado-b-juros', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'o teste só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    titulo = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, cliente_nome: `Cliente Achado B ${RUN}`, descricao: `Regressão achado B ${RUN}`, valor: 3080,
      data_emissao: dia(-3), data_vencimento: dia(-1), status: 'aberto', forma_pagamento: 'pix',
    })).id
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Regressão achado B ${RUN}`,
    })).id
  })

  test.afterAll(async () => {
    if (lote) {
      const movs = (await dbSelect<{ id: string }>('conciliacao_movimento', `lote_id=eq.${lote}&select=id`)).map((m) => m.id)
      if (movs.length) await dbDelete('conciliacao_vinculo', `movimento_id=in.(${movs.join(',')})`)
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`)
      await dbDelete('conciliacao_lote', `id=eq.${lote}`)
    }
    if (titulo) await dbPatch('erp_receber', `id=eq.${titulo}`, { deleted_at: new Date().toISOString() })
  })

  async function rpcRobo<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as T
  }
  const estado = async () => (await dbSelect<Titulo>('erp_receber', `id=eq.${titulo}&select=juros,valor_pago,status`))[0]

  test('conciliar com ajuste → desconciliar → reconciliar por "Vincular vários": juros ficam 10, título pago', async () => {
    const m = (await dbInsert<{ id: string }>('conciliacao_movimento', {
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(0), valor: 3090, descricao: `PIX Achado B ${RUN}`,
      natureza: 'credito', status: 'pendente',
    })).id

    // 1ª conciliação: modal de ajuste (banco 3.090 × título 3.080 → juros 10), conciliando o movimento
    const r1 = await rpcRobo<{ sucesso: boolean; conciliado: boolean }>('fn_conciliacao_ajustar_valores', {
      p_lancamento_id: titulo, p_tipo: 'receber', p_valor_juros: 10, p_valor_desconto: 0,
      p_observacao: null, p_valor_novo: null, p_movimento_id: m,
    })
    expect(r1).toMatchObject({ sucesso: true, conciliado: true })
    expect(await estado()).toMatchObject({ status: 'pago' })

    // desconciliar: nenhum valor recebido pode sobrar (antes sobravam os R$ 10 dos juros)
    await rpcRobo('fn_conciliacao_desvincular', { p_lancamento_id: titulo, p_tipo: 'receber' })
    const desfeito = await estado()
    expect(Number(desfeito.valor_pago ?? 0), 'sem valor_pago-fantasma depois de desconciliar').toBe(0)

    // reconciliar pelo "Vincular vários": vincula, a tela sugere acréscimo = banco − soma vinculada, fecha agrupado
    const v = await rpcRobo<{ ok: boolean }>('fn_conciliacao_vincular', {
      p_movimento_id: m, p_lancamento_tabela: 'erp_receber', p_lancamento_id: titulo, p_valor: null, p_operador_id: null,
    })
    expect(v.ok).toBe(true)
    const resumo = await rpcRobo<{ soma_vinculada: number }>('fn_conciliacao_vinculos', { p_movimento_id: m })
    const acrescimo = Math.round((3090 - Number(resumo.soma_vinculada ?? 0)) * 100) / 100
    expect(acrescimo, 'a tela sugere só a diferença real (10), não 20').toBe(10)
    await rpcRobo('fn_conciliacao_fechar_agrupado', {
      p_movimento_id: m, p_operador_id: null, p_tolerancia: 0.05, p_juros: acrescimo, p_multa: 0, p_desconto: 0,
      p_ajuste_lancamento_id: titulo, p_observacao: null,
    })

    const final = await estado()
    expect(Number(final.juros), 'juros não dobram').toBe(10)
    expect(Number(final.valor_pago)).toBe(3090)
    expect(final.status, 'quitado — sem R$ 10 em aberto que não existem').toBe('pago')
  })
})
