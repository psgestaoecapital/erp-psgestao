// #145 (André · PS) · "Vincular vários" (fatura agrupada) precisava de baixa PARCIAL por conta. O banco já aceitava
// (cada vínculo guarda o seu valor: fn_conciliacao_vincular p_valor; a baixa nasce dele no sync); a tela sempre
// mandava o valor cheio. Agora cada conta vinculada tem "baixa parcial" — o que a tela chama é exatamente isto:
// vincular com p_valor < saldo e fechar a fatura. Aqui as RPCs rodam COMO O ROBÔ (as mesmas da tela); o service_role
// só prepara títulos/extrato e confere o banco. Demonstração Comércio (GE); títulos (soft) e extrato de teste removidos.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'
import { conferirBaixaParcial, saldoTitulo } from '../../../src/lib/conciliacao/baixaParcial'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Titulo = { valor: number; valor_pago: number | null; juros: number | null; multa: number | null; desconto: number | null; status: string }

test.describe('#145 · fatura agrupada com baixa parcial por conta', () => {
  let token = ''
  let lote = ''
  const titulos: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-145-conciliacao-baixa-parcial', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Aceitação #145 baixa parcial ${RUN}`,
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
  async function novoTitulo(valor: number, nome: string): Promise<string> {
    const { id } = await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, fornecedor_nome: nome, descricao: `Aceitação #145 · ${nome} · ${RUN}`, valor,
      data_emissao: dia(-5), data_vencimento: dia(-1), status: 'aberto', forma_pagamento: 'cartao_credito',
    })
    titulos.push(id)
    return id
  }
  const novoDebito = async (valor: number) => (await dbInsert<{ id: string }>('conciliacao_movimento', {
    lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(0), valor, descricao: `FATURA CARTAO #145 ${RUN}`, natureza: 'debito', status: 'pendente',
  })).id
  const titulo = async (id: string) => (await dbSelect<Titulo>('erp_pagar', `id=eq.${id}&select=valor,valor_pago,juros,multa,desconto,status`))[0]
  const vincular = (m: string, t: string, valor: number | null) => rpcRobo<{ ok: boolean; erro?: string }>('fn_conciliacao_vincular', {
    p_movimento_id: m, p_lancamento_tabela: 'erp_pagar', p_lancamento_id: t, p_valor: valor, p_operador_id: null,
  })

  test('caminho principal: fatura de R$ 1.500 paga A inteira (R$ 1.000) e B em parte (R$ 500 de R$ 800) → B fica parcial com R$ 300 em aberto', async () => {
    const a = await novoTitulo(1000, 'Fornecedor 145 A')
    const b = await novoTitulo(800, 'Fornecedor 145 B')
    const m = await novoDebito(1500)
    expect((await vincular(m, a, null)).ok).toBe(true)
    expect((await vincular(m, b, null)).ok, 'primeiro vincula cheio (como a tela faz ao adicionar)').toBe(true)
    // a tela: "baixa parcial" → confere contra o saldo → vincula de novo com o valor digitado (sobrescreve o vínculo)
    const conf = conferirBaixaParcial(saldoTitulo(await titulo(b)), 500)
    expect(conf.ok && conf.parcial && conf.restante === 300, 'a regra da tela: parcial, restam R$ 300').toBe(true)
    expect((await vincular(m, b, 500)).ok, 'o vínculo passa a valer R$ 500').toBe(true)
    await rpcRobo('fn_conciliacao_fechar_agrupado', { p_movimento_id: m, p_operador_id: null })
    const ta = await titulo(a), tb = await titulo(b)
    expect(Number(ta.valor_pago)).toBe(1000)
    expect(ta.status).toBe('pago')
    expect(Number(tb.valor_pago), 'B recebeu só a parte desta fatura').toBe(500)
    expect(tb.status, 'B fica parcial, com o saldo em aberto').toBe('parcial')
  })

  test('baixa parcial acima do saldo do título é recusada (tela e banco)', async () => {
    const c = await novoTitulo(800, 'Fornecedor 145 C')
    const m = await novoDebito(900)
    expect(conferirBaixaParcial(saldoTitulo(await titulo(c)), 900).ok, 'a tela recusa antes de enviar').toBe(false)
    const r = await vincular(m, c, 900)
    expect(r.ok, 'o banco também recusa (não baixa mais que o título)').toBe(false)
    expect(Number((await titulo(c)).valor_pago ?? 0)).toBe(0)
  })
})
