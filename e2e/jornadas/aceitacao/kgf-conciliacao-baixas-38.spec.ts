// RD-78 · Aceitação do chamado #38 (KGF): a conciliação de CONTAS A RECEBER respeita as baixas já feitas.
// Relato: título de R$ 1.000, a atendente marca R$ 250 recebido, o extrato traz o crédito de R$ 750 e, ao
// conciliar, o título fica "parcial" com R$ 750 — os R$ 250 somem. Migration 20260926260000.
// @pos-migration: só passa com a migration aplicada — o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
//
// Roda na Demonstração Comércio (GE), nunca em empresa real. As RPCs são chamadas COMO O ROBÔ (token de
// usuário, mesmas permissões da tela); o service_role só prepara títulos/extrato e confere o banco.
// Os títulos criados aqui são excluídos (soft) no fim e o lote de extrato de teste é apagado.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

type Titulo = { valor_pago: number | null; status: string; data_pagamento: string | null }
type Baixa = { valor: number; origem: string; movimento_banco_id: string | null }
type Sugestao = { lancamento_id: string; match_score: number; status_lancamento: string }

const hoje = new Date().toISOString().slice(0, 10)
const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

test.describe('Aceitação #38 — conciliar receber não apaga a baixa já feita', () => {
  let token = ''
  let lote = ''
  const titulos: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-38-conciliacao-baixas', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Aceitação #38 ${new Date().toISOString()}`,
    })).id
  })

  test.afterAll(async () => {
    if (lote) {
      await dbDelete('conciliacao_vinculo', `movimento_id=in.(${(await dbSelect<{ id: string }>('conciliacao_movimento', `lote_id=eq.${lote}&select=id`)).map((m) => m.id).join(',') || '00000000-0000-0000-0000-000000000000'})`)
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`)
      await dbDelete('conciliacao_lote', `id=eq.${lote}`)
    }
    for (const id of titulos) await dbPatch('erp_receber', `id=eq.${id}`, { deleted_at: new Date().toISOString() })
  })

  // RPC como o robô (usuário da demo), não como service_role
  async function rpcRobo<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as T
  }

  async function novoTitulo(valor: number, nome: string): Promise<string> {
    const { id } = await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, cliente_nome: nome, descricao: `Aceitação #38 · ${nome}`, valor,
      data_emissao: diasAtras(5), data_vencimento: diasAtras(1), status: 'aberto', forma_pagamento: 'pix',
    })
    titulos.push(id)
    return id
  }
  const novoCredito = async (valor: number, descricao: string) => (await dbInsert<{ id: string }>('conciliacao_movimento', {
    lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: hoje, valor, descricao, natureza: 'credito', status: 'pendente',
  })).id
  const titulo = async (id: string) => (await dbSelect<Titulo>('erp_receber', `id=eq.${id}&select=valor_pago,status,data_pagamento`))[0]
  const baixas = (id: string) => dbSelect<Baixa>('erp_receber_baixa', `receber_id=eq.${id}&deleted_at=is.null&select=valor,origem,movimento_banco_id&order=criado_em`)
  const baixaManual = (id: string, valor: number) => rpcRobo('fn_receber_baixar_pagamento', {
    p_receber_id: id, p_data_pagamento: diasAtras(1), p_conta_bancaria_id: null, p_forma_pagamento: 'pix', p_valor_pago: valor, p_origem: 'manual',
  })

  test('R$ 250 marcado + crédito de R$ 750 → título quitado em R$ 1.000, com as duas baixas @pos-migration', async () => {
    const t = await novoTitulo(1000, 'Cliente Aceitação 38 A')
    await baixaManual(t, 250)
    const m = await novoCredito(750, 'PIX Cliente Aceitação 38 A')

    // o título parcial aparece na sugestão pelo SALDO (antes nem era listado)
    const sug = await rpcRobo<Sugestao[]>('fn_conciliacao_sugerir_match', { p_movimento_id: m, p_max_sugestoes: 50 })
    const minha = sug.find((s) => s.lancamento_id === t)
    expect(minha, 'o título com R$ 250 já recebido aparece como candidato do crédito de R$ 750').toBeTruthy()
    expect(Number(minha!.match_score), 'pontua pelo saldo (750), não pelo valor cheio').toBeGreaterThanOrEqual(90)

    const r = await rpcRobo<{ ok: boolean }>('fn_conciliacao_vincular', { p_movimento_id: m, p_lancamento_tabela: 'erp_receber', p_lancamento_id: t, p_valor: null, p_operador_id: null })
    expect(r.ok, 'concilia sem pedir motivo de "baixo match"').toBe(true)

    const depois = await titulo(t)
    expect(Number(depois.valor_pago), 'os R$ 250 não somem').toBe(1000)
    expect(depois.status).toBe('pago')
    const bx = await baixas(t)
    expect(bx.map((b) => Number(b.valor)).sort((a, b) => a - b), 'baixa manual + baixa da conciliação').toEqual([250, 750])
    expect(bx.find((b) => Number(b.valor) === 750)?.movimento_banco_id, 'a baixa de 750 está ligada ao crédito').toBe(m)

    // desfazer a conciliação devolve exatamente o que havia antes: R$ 250, parcial
    await rpcRobo('fn_conciliacao_desvincular', { p_lancamento_id: t, p_tipo: 'receber' })
    const desfeito = await titulo(t)
    expect(Number(desfeito.valor_pago)).toBe(250)
    expect(desfeito.status).toBe('parcial')
  })

  test('crédito do MESMO dinheiro já marcado confirma a baixa, sem duplicar @pos-migration', async () => {
    const t = await novoTitulo(1000, 'Cliente Aceitação 38 B')
    await baixaManual(t, 250)
    const m = await novoCredito(250, 'PIX Cliente Aceitação 38 B')
    const r = await rpcRobo<{ ok: boolean }>('fn_conciliacao_vincular', { p_movimento_id: m, p_lancamento_tabela: 'erp_receber', p_lancamento_id: t, p_valor: null, p_operador_id: null })
    expect(r.ok).toBe(true)
    const depois = await titulo(t)
    expect(Number(depois.valor_pago), 'continua R$ 250 — não vira R$ 500').toBe(250)
    const bx = await baixas(t)
    expect(bx, 'uma única baixa, agora ligada ao crédito').toHaveLength(1)
    expect(bx[0].movimento_banco_id).toBe(m)
    await rpcRobo('fn_conciliacao_desvincular', { p_lancamento_id: t, p_tipo: 'receber' })
    expect(Number((await titulo(t)).valor_pago), 'desvincular não apaga a baixa manual').toBe(250)
  })

  test('título quitado só pela conciliação volta a vencido ao desvincular @pos-migration', async () => {
    const t = await novoTitulo(1000, 'Cliente Aceitação 38 C')
    const m = await novoCredito(1000, 'PIX Cliente Aceitação 38 C')
    const r = await rpcRobo<{ ok: boolean }>('fn_conciliacao_vincular', { p_movimento_id: m, p_lancamento_tabela: 'erp_receber', p_lancamento_id: t, p_valor: null, p_operador_id: null })
    expect(r.ok).toBe(true)
    expect((await titulo(t)).status).toBe('pago')
    await rpcRobo('fn_conciliacao_desvincular', { p_lancamento_id: t, p_tipo: 'receber' })
    const desfeito = await titulo(t)
    expect(Number(desfeito.valor_pago ?? 0), 'nenhum valor recebido fica').toBe(0)
    expect(['aberto', 'vencido'], 'reabre (antes ficava "pago" com baixa-fantasma)').toContain(desfeito.status)
    expect(desfeito.data_pagamento, 'sem data de pagamento').toBeNull()
    expect(await baixas(t), 'nenhuma baixa ativa').toHaveLength(0)
  })

  test('crédito agrupado (1 crédito → 2 títulos, um já pago à mão) respeita a baixa manual @pos-migration', async () => {
    const a = await novoTitulo(1000, 'Cliente Aceitação 38 D1')
    const b = await novoTitulo(500, 'Cliente Aceitação 38 D2')
    await baixaManual(b, 500)
    const m = await novoCredito(1500, 'PIX Aceitação 38 agrupado')
    await rpcRobo('fn_conciliacao_vincular', { p_movimento_id: m, p_lancamento_tabela: 'erp_receber', p_lancamento_id: a, p_valor: 1000, p_operador_id: null })
    await rpcRobo('fn_conciliacao_vincular', { p_movimento_id: m, p_lancamento_tabela: 'erp_receber', p_lancamento_id: b, p_valor: 500, p_operador_id: null })
    const f = await rpcRobo<{ ok: boolean }>('fn_conciliacao_fechar_agrupado', { p_movimento_id: m, p_operador_id: null })
    expect(f.ok).toBe(true)
    expect(Number((await titulo(a)).valor_pago)).toBe(1000)
    expect(Number((await titulo(b)).valor_pago), 'o título pago à mão não recebe de novo').toBe(500)
    expect(await baixas(b), 'a baixa manual é reaproveitada').toHaveLength(1)

    const d = await rpcRobo<{ sucesso: boolean }>('fn_conciliacao_desvincular_movimento', { p_movimento_id: m, p_operador_id: null })
    expect(d.sucesso).toBe(true)
    expect(['aberto', 'vencido']).toContain((await titulo(a)).status)
    const tb = await titulo(b)
    expect(Number(tb.valor_pago), 'a baixa manual continua').toBe(500)
    expect(tb.status).toBe('pago')
  })
})
