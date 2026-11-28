// #10136 CAMADA 3 (gate de regressão) · conciliação agrupada com ajuste POR TÍTULO.
// Cenário exato que travou a sócia Jordana: 1 crédito paga N títulos atrasados com juros DIFERENTE
// em cada → os N têm de ficar PAGOS (nenhum "parcial"). E a invariante: título com valor_pago >= valor
// original nunca fica parcial. Depende da migration do p_ajustes (writer) → @pos-migration.
//
// Roda na Demonstração Comércio (GE), nunca em empresa real (RD-69/LGPD). As RPCs são chamadas COMO O
// ROBÔ (token de usuário, mesmas permissões da tela); o service_role só prepara títulos/extrato e confere.
// Os títulos e o lote criados aqui são excluídos (soft/hard) no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

type Titulo = { valor: number; valor_pago: number | null; juros: number | null; status: string }

const hoje = new Date().toISOString().slice(0, 10)
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

test.describe('#10136 — conciliação agrupada: cada título quita com o SEU juros', () => {
  let token = ''
  let lote = ''
  const titulos: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('conciliacao-10136-ajuste-por-titulo', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `#10136 ajuste por título ${new Date().toISOString()}`,
    })).id
  })

  test.afterAll(async () => {
    for (const id of titulos) await dbPatch('erp_receber', `id=eq.${id}`, { deleted_at: new Date().toISOString() })
    if (lote) {
      const movs = (await dbSelect<{ id: string }>('conciliacao_movimento', `lote_id=eq.${lote}&select=id`)).map((m) => m.id)
      if (movs.length) await dbDelete('conciliacao_vinculo', `movimento_id=in.(${movs.join(',')})`)
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`)
      await dbDelete('conciliacao_lote', `id=eq.${lote}`)
    }
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

  async function novoTituloAtrasado(valor: number, nome: string): Promise<string> {
    const { id } = await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, cliente_nome: nome, descricao: `#10136 · ${nome} · ${RUN}`, valor,
      data_emissao: diasAtras(40), data_vencimento: diasAtras(10), status: 'aberto', forma_pagamento: 'pix',
    })
    titulos.push(id)
    return id
  }
  const novoCredito = async (valor: number, descricao: string) => (await dbInsert<{ id: string }>('conciliacao_movimento', {
    lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: hoje, valor, descricao, natureza: 'credito', status: 'pendente',
  })).id
  const titulo = async (id: string) => (await dbSelect<Titulo>('erp_receber', `id=eq.${id}&select=valor,valor_pago,juros,status`))[0]

  test('1 crédito → 3 títulos atrasados com juros DIFERENTE em cada: os 3 ficam PAGOS @pos-migration', async () => {
    // T1 200+10, T2 300+25, T3 150+5 → crédito 690 (juros distintos por título)
    const casos = [
      { valor: 200, juros: 10, nome: 'Jornada 10136 A' },
      { valor: 300, juros: 25, nome: 'Jornada 10136 B' },
      { valor: 150, juros: 5, nome: 'Jornada 10136 C' },
    ]
    const ids: string[] = []
    for (const c of casos) ids.push(await novoTituloAtrasado(c.valor, c.nome))
    const total = casos.reduce((s, c) => s + c.valor + c.juros, 0) // 690
    const m = await novoCredito(total, 'PIX fatura 3 títulos #10136')

    // vincula cada título pelo valor ORIGINAL (o juros vai no ajuste por título)
    for (let i = 0; i < casos.length; i++) {
      await rpcRobo('fn_conciliacao_vincular', { p_movimento_id: m, p_lancamento_tabela: 'erp_receber', p_lancamento_id: ids[i], p_valor: casos[i].valor, p_operador_id: null })
    }

    const pAjustes = casos.map((c, i) => ({ lancamento_id: ids[i], lancamento_tabela: 'erp_receber', juros: c.juros, multa: 0, desconto: 0 }))
    const f = await rpcRobo<{ ok: boolean; ajuste_por_titulo?: boolean; erro?: string }>('fn_conciliacao_fechar_agrupado', {
      p_movimento_id: m, p_operador_id: null, p_tolerancia: 0.05, p_juros: 0, p_multa: 0, p_desconto: 0,
      p_ajuste_lancamento_id: null, p_observacao: 'aceitação #10136', p_ajustes: pAjustes,
    })
    expect(f.ok, `fechou com ajuste por título (erro: ${f.erro ?? '—'})`).toBe(true)
    expect(f.ajuste_por_titulo, 'a RPC reconhece o caminho por título').toBe(true)

    // os 3 ficam PAGOS, com o SEU juros, nenhum parcial
    for (let i = 0; i < casos.length; i++) {
      const t = await titulo(ids[i])
      expect(t.status, `título ${casos[i].nome} (valor ${casos[i].valor}, juros ${casos[i].juros}) deve ficar pago`).toBe('pago')
      expect(Number(t.valor_pago), `valor_pago = valor + juros do título ${casos[i].nome}`).toBe(casos[i].valor + casos[i].juros)
      expect(Number(t.juros), `juros do título ${casos[i].nome} gravado na coluna juros`).toBe(casos[i].juros)
    }

    // idempotência: re-chamar o fechamento não altera nada (movimento já conciliado)
    const f2 = await rpcRobo<{ ok: boolean; ja?: boolean }>('fn_conciliacao_fechar_agrupado', { p_movimento_id: m, p_operador_id: null })
    expect(f2.ok, 'segunda chamada é no-op idempotente').toBe(true)
    for (let i = 0; i < casos.length; i++) {
      expect((await titulo(ids[i])).status, 'status estável na 2ª chamada').toBe('pago')
    }
  })

  test('invariante: título com valor_pago >= valor original nunca fica parcial @pos-migration', async () => {
    const t = await novoTituloAtrasado(400, 'Jornada 10136 invariante')
    const m = await novoCredito(430, 'PIX título único com juros #10136')
    await rpcRobo('fn_conciliacao_vincular', { p_movimento_id: m, p_lancamento_tabela: 'erp_receber', p_lancamento_id: t, p_valor: 400, p_operador_id: null })
    const f = await rpcRobo<{ ok: boolean }>('fn_conciliacao_fechar_agrupado', {
      p_movimento_id: m, p_operador_id: null, p_tolerancia: 0.05, p_juros: 0, p_multa: 0, p_desconto: 0,
      p_ajuste_lancamento_id: null, p_observacao: 'aceitação #10136 invariante',
      p_ajustes: [{ lancamento_id: t, lancamento_tabela: 'erp_receber', juros: 30, multa: 0, desconto: 0 }],
    })
    expect(f.ok).toBe(true)
    const depois = await titulo(t)
    expect(Number(depois.valor_pago), 'recebeu 400 + 30 de juros').toBe(430)
    expect(depois.status, 'valor_pago (430) >= valor original (400) ⇒ pago, nunca parcial').toBe('pago')
  })
})
