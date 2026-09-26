// RD-78 · Aceitação de CONTAS A PAGAR com o mesmo defeito do #38 (decisão do CEO 26/09): a conciliação de
// contas a pagar passa a respeitar os pagamentos já registrados. Migration 20260926330000 (erp_pagar_baixa +
// sync da conciliação). @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
//
// Demonstração Comércio (GE). As RPCs são chamadas COMO O ROBÔ (as mesmas da tela); o service_role só prepara
// títulos/extrato e confere o banco. Títulos excluídos (soft) e extrato de teste apagado no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Titulo = { valor_pago: number | null; status: string; data_pagamento: string | null }

test.describe('Aceitação contas a pagar — conciliar não apaga o pagamento já feito', () => {
  let token = ''
  let lote = ''
  const titulos: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pagar-conciliacao-baixas', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Aceitação pagar baixas ${RUN}`,
    })).id
  })

  test.afterAll(async () => {
    if (lote) {
      const movs = (await dbSelect<{ id: string }>('conciliacao_movimento', `lote_id=eq.${lote}&select=id`)).map((m) => m.id)
      if (movs.length) await dbDelete('conciliacao_vinculo', `movimento_id=in.(${movs.join(',')})`)
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`)
      await dbDelete('conciliacao_lote', `id=eq.${lote}`)
    }
    for (const id of titulos) await dbPatch('erp_pagar', `id=eq.${id}`, { deleted_at: new Date().toISOString() })
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

  async function novoTitulo(valor: number, nome: string, forma = 'pix'): Promise<string> {
    const { id } = await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, fornecedor_nome: nome, descricao: `Aceitação pagar · ${nome} · ${RUN}`, valor,
      data_emissao: dia(-5), data_vencimento: dia(-1), status: 'aberto', forma_pagamento: forma,
    })
    titulos.push(id)
    return id
  }
  const novoDebito = async (valor: number, descricao: string) => (await dbInsert<{ id: string }>('conciliacao_movimento', {
    lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(0), valor, descricao, natureza: 'debito', status: 'pendente',
  })).id
  const titulo = async (id: string) => (await dbSelect<Titulo>('erp_pagar', `id=eq.${id}&select=valor_pago,status,data_pagamento`))[0]
  const baixas = (id: string) => dbSelect<{ valor: number; origem: string; movimento_banco_id: string | null }>('erp_pagar_baixa',
    `pagar_id=eq.${id}&deleted_at=is.null&select=valor,origem,movimento_banco_id&order=criado_em`)
  const pagarManual = (id: string, valor: number, forma = 'pix') => rpcRobo('fn_pagar_baixar_pagamento', {
    p_pagar_id: id, p_data_pagamento: dia(-1), p_conta_bancaria_id: null, p_forma_pagamento: forma, p_valor_pago: valor, p_origem: 'manual',
  })
  const vincular = (m: string, t: string) => rpcRobo<{ ok: boolean }>('fn_conciliacao_vincular', {
    p_movimento_id: m, p_lancamento_tabela: 'erp_pagar', p_lancamento_id: t, p_valor: null, p_operador_id: null,
  })

  test('R$ 250 pago à mão + débito de R$ 750 → título quitado em R$ 1.000, com os dois pagamentos @pos-migration', async () => {
    const t = await novoTitulo(1000, 'Fornecedor Pagar A')
    await pagarManual(t, 250)
    const m = await novoDebito(750, `PIX ENVIADO Fornecedor Pagar A ${RUN}`)

    const sug = await rpcRobo<{ lancamento_id: string; match_score: number; status_lancamento: string }[]>(
      'fn_conciliacao_sugerir_match', { p_movimento_id: m, p_max_sugestoes: 50 })
    const minha = sug.find((s) => s.lancamento_id === t)
    expect(minha, 'o título parcial aparece como candidato do débito de R$ 750').toBeTruthy()

    expect((await vincular(m, t)).ok).toBe(true)
    const depois = await titulo(t)
    expect(Number(depois.valor_pago), 'os R$ 250 não somem').toBe(1000)
    expect(depois.status).toBe('pago')
    const bx = await baixas(t)
    expect(bx.map((b) => Number(b.valor)).sort((a, b) => a - b), 'pagamento manual + pagamento da conciliação').toEqual([250, 750])

    await rpcRobo('fn_conciliacao_desvincular', { p_lancamento_id: t, p_tipo: 'pagar' })
    const desfeito = await titulo(t)
    expect(Number(desfeito.valor_pago), 'desconciliar devolve exatamente o que havia antes').toBe(250)
    expect(desfeito.status).toBe('parcial')
  })

  test('débito do MESMO dinheiro já pago confirma o pagamento, sem duplicar @pos-migration', async () => {
    const t = await novoTitulo(1000, 'Fornecedor Pagar B')
    await pagarManual(t, 250)
    const m = await novoDebito(250, `PIX ENVIADO Fornecedor Pagar B ${RUN}`)
    expect((await vincular(m, t)).ok).toBe(true)
    expect(Number((await titulo(t)).valor_pago), 'continua R$ 250 — não vira R$ 500').toBe(250)
    const bx = await baixas(t)
    expect(bx, 'um único pagamento, agora ligado ao débito').toHaveLength(1)
    expect(bx[0].movimento_banco_id).toBe(m)
    await rpcRobo('fn_conciliacao_desvincular', { p_lancamento_id: t, p_tipo: 'pagar' })
    expect(Number((await titulo(t)).valor_pago), 'desvincular não apaga o pagamento manual').toBe(250)
  })

  test('título quitado só pela conciliação reabre ao desvincular @pos-migration', async () => {
    const t = await novoTitulo(1000, 'Fornecedor Pagar C')
    const m = await novoDebito(1000, `PIX ENVIADO Fornecedor Pagar C ${RUN}`)
    expect((await vincular(m, t)).ok).toBe(true)
    expect((await titulo(t)).status).toBe('pago')
    await rpcRobo('fn_conciliacao_desvincular', { p_lancamento_id: t, p_tipo: 'pagar' })
    const desfeito = await titulo(t)
    expect(Number(desfeito.valor_pago ?? 0), 'nenhum valor pago fica').toBe(0)
    expect(['aberto', 'vencido']).toContain(desfeito.status)
    expect(desfeito.data_pagamento, 'sem data de pagamento').toBeNull()
  })

  test('fatura agrupada (1 débito → 2 títulos, um já pago à mão) respeita o pagamento manual @pos-migration', async () => {
    const a = await novoTitulo(1000, 'Fornecedor Pagar D1', 'cartao_credito')
    const b = await novoTitulo(500, 'Fornecedor Pagar D2', 'cartao_credito')
    await pagarManual(a, 1000, 'cartao_credito')
    const m = await novoDebito(1500, `FATURA CARTAO ${RUN}`)
    await rpcRobo('fn_conciliacao_vincular', { p_movimento_id: m, p_lancamento_tabela: 'erp_pagar', p_lancamento_id: a, p_valor: 1000, p_operador_id: null })
    await rpcRobo('fn_conciliacao_vincular', { p_movimento_id: m, p_lancamento_tabela: 'erp_pagar', p_lancamento_id: b, p_valor: 500, p_operador_id: null })
    await rpcRobo('fn_conciliacao_fechar_agrupado', { p_movimento_id: m, p_operador_id: null })
    expect(Number((await titulo(a)).valor_pago), 'título já pago não duplica').toBe(1000)
    expect(await baixas(a), 'um único pagamento no título já pago').toHaveLength(1)
    expect(Number((await titulo(b)).valor_pago)).toBe(500)
    expect((await titulo(b)).status).toBe('pago')

    await rpcRobo('fn_conciliacao_desvincular_movimento', { p_movimento_id: m, p_operador_id: null })
    expect(Number((await titulo(a)).valor_pago), 'o pagamento manual continua').toBe(1000)
    expect(Number((await titulo(b)).valor_pago ?? 0), 'o pago só pela fatura reabre').toBe(0)
  })
})
